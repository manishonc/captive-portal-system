const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Database ───
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "captive_portal",
  user: process.env.DB_USER || "radius",
  password: process.env.DB_PASS || "radiuspass",
});

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey123";
const RADIUS_SECRET = process.env.RADIUS_SECRET || "testing123";

// ─── Middleware: Auth ───
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ═══════════════════════════════════════════
// PUBLIC ROUTES - Called by Captive Portal
// ═══════════════════════════════════════════

/**
 * POST /api/auth/guest
 * Main endpoint called when a guest connects via the captive portal.
 * Creates a RADIUS user and returns credentials for the AP to authenticate.
 *
 * Aruba Instant On External Captive Portal Flow:
 * 1. Guest connects to SSID → redirected to portal page
 * 2. Guest enters email/phone → portal calls this endpoint
 * 3. API creates RADIUS user (MAC-based) → returns success
 * 4. Portal redirects guest to Aruba's authentication URL
 * 5. Aruba authenticates via RADIUS → guest gets internet
 */
app.post("/api/auth/guest", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      mac_address,   // Guest's MAC (from Aruba redirect params)
      email,
      phone,
      name,
      auth_method = "email",  // email | phone | click-through
      location_id = 1,
      ap_mac,        // Aruba AP MAC (from redirect params)
      aruba_url,     // Aruba login URL (from redirect params)
    } = req.body;

    if (!mac_address) {
      return res.status(400).json({ error: "MAC address is required" });
    }

    const cleanMac = mac_address.toLowerCase().replace(/[^a-f0-9]/g, "");
    const formattedMac = cleanMac.match(/.{2}/g)?.join(":") || cleanMac;

    // Generate a simple password for RADIUS auth
    const password = crypto.randomBytes(8).toString("hex");

    await client.query("BEGIN");

    // ─── Upsert guest record ───
    const guestResult = await client.query(
      `INSERT INTO guests (mac_address, email, phone, name, auth_method, location_id, last_seen, visit_count)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
       ON CONFLICT (mac_address) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, guests.email),
         phone = COALESCE(EXCLUDED.phone, guests.phone),
         name = COALESCE(EXCLUDED.name, guests.name),
         last_seen = NOW(),
         visit_count = guests.visit_count + 1
       RETURNING id`,
      [formattedMac, email, phone, name, auth_method, location_id]
    );

    // Wait — guests.mac_address needs a unique constraint. Let's use the username approach.
    const guestId = guestResult.rows[0]?.id;

    // ─── Get location settings ───
    const locResult = await client.query(
      "SELECT * FROM locations WHERE id = $1",
      [location_id]
    );
    const location = locResult.rows[0] || {};

    // ─── Create/Update RADIUS user ───
    // Use MAC address as username for RADIUS
    const radiusUsername = formattedMac;

    // Remove existing RADIUS entries for this MAC
    await client.query("DELETE FROM radcheck WHERE username = $1", [radiusUsername]);
    await client.query("DELETE FROM radreply WHERE username = $1", [radiusUsername]);
    await client.query("DELETE FROM radusergroup WHERE username = $1", [radiusUsername]);

    // Add password check (Cleartext for simplicity with PAP)
    await client.query(
      "INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, 'Cleartext-Password', ':=', $2)",
      [radiusUsername, password]
    );

    // Add session timeout from location settings
    if (location.session_timeout) {
      await client.query(
        "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Session-Timeout', '=', $2)",
        [radiusUsername, String(location.session_timeout)]
      );
    }

    // Add idle timeout
    if (location.idle_timeout) {
      await client.query(
        "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Idle-Timeout', '=', $2)",
        [radiusUsername, String(location.idle_timeout)]
      );
    }

    // Add bandwidth limits (WISPr attributes for Aruba)
    if (location.bandwidth_limit_down > 0) {
      await client.query(
        "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'WISPr-Bandwidth-Max-Down', '=', $2)",
        [radiusUsername, String(location.bandwidth_limit_down * 1000)] // Convert Kbps to bps
      );
    }
    if (location.bandwidth_limit_up > 0) {
      await client.query(
        "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'WISPr-Bandwidth-Max-Up', '=', $2)",
        [radiusUsername, String(location.bandwidth_limit_up * 1000)]
      );
    }

    // Add to guests group
    await client.query(
      "INSERT INTO radusergroup (username, groupname, priority) VALUES ($1, 'guests', 1)",
      [radiusUsername]
    );

    // ─── Create session record ───
    await client.query(
      `INSERT INTO sessions (guest_id, location_id, mac_address, nas_ip, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [guestId, location_id, formattedMac, location.nas_ip || "0.0.0.0"]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Authentication successful",
      data: {
        username: radiusUsername,
        password: password,
        session_timeout: location.session_timeout || 3600,
        redirect_url: location.redirect_url || "",
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Guest auth error:", err);
    res.status(500).json({ error: "Authentication failed" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/auth/status/:mac
 * Check if a MAC address is currently authorized
 */
app.get("/api/auth/status/:mac", async (req, res) => {
  try {
    const mac = req.params.mac.toLowerCase().replace(/[^a-f0-9]/g, "");
    const formattedMac = mac.match(/.{2}/g)?.join(":") || mac;

    const result = await pool.query(
      "SELECT * FROM radcheck WHERE username = $1",
      [formattedMac]
    );

    if (result.rows.length > 0) {
      res.json({ authorized: true, username: formattedMac });
    } else {
      res.json({ authorized: false });
    }
  } catch (err) {
    res.status(500).json({ error: "Status check failed" });
  }
});

/**
 * GET /api/location/:id
 * Get location info for the splash page
 */
app.get("/api/location/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, ssid, splash_message, redirect_url, terms_url, logo_url FROM locations WHERE id = $1",
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch location" });
  }
});

// ═══════════════════════════════════════════
// ADMIN ROUTES - Dashboard API
// ═══════════════════════════════════════════

// Admin Login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM admins WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── Dashboard Stats ───
app.get("/api/admin/stats", authMiddleware, async (req, res) => {
  try {
    const [guests, sessions, active, locations] = await Promise.all([
      pool.query("SELECT COUNT(*) as total FROM guests"),
      pool.query("SELECT COUNT(*) as total FROM sessions"),
      pool.query("SELECT COUNT(*) as total FROM sessions WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) as total FROM locations"),
    ]);

    const todayGuests = await pool.query(
      "SELECT COUNT(*) as total FROM guests WHERE created_at >= CURRENT_DATE"
    );

    const recentGuests = await pool.query(
      `SELECT g.*, l.name as location_name
       FROM guests g
       LEFT JOIN locations l ON g.location_id = l.id
       ORDER BY g.last_seen DESC LIMIT 10`
    );

    res.json({
      total_guests: parseInt(guests.rows[0].total),
      total_sessions: parseInt(sessions.rows[0].total),
      active_sessions: parseInt(active.rows[0].total),
      total_locations: parseInt(locations.rows[0].total),
      today_guests: parseInt(todayGuests.rows[0].total),
      recent_guests: recentGuests.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ─── Guests CRUD ───
app.get("/api/admin/guests", authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 25, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT g.*, l.name as location_name FROM guests g LEFT JOIN locations l ON g.location_id = l.id`;
    let countQuery = "SELECT COUNT(*) as total FROM guests";
    const params = [];

    if (search) {
      query += " WHERE g.email ILIKE $1 OR g.phone ILIKE $1 OR g.name ILIKE $1 OR g.mac_address ILIKE $1";
      countQuery += " WHERE email ILIKE $1 OR phone ILIKE $1 OR name ILIKE $1 OR mac_address ILIKE $1";
      params.push(`%${search}%`);
    }

    query += ` ORDER BY g.last_seen DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [result, count] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, search ? [`%${search}%`] : []),
    ]);

    res.json({
      guests: result.rows,
      total: parseInt(count.rows[0].total),
      page: parseInt(page),
      pages: Math.ceil(count.rows[0].total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch guests" });
  }
});

// ─── Locations CRUD ───
app.get("/api/admin/locations", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM locations ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

app.post("/api/admin/locations", authMiddleware, async (req, res) => {
  try {
    const {
      name, address, ssid, nas_ip,
      bandwidth_limit_up, bandwidth_limit_down,
      session_timeout, idle_timeout, daily_limit,
      splash_message, redirect_url, terms_url, logo_url,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO locations (name, address, ssid, nas_ip, bandwidth_limit_up, bandwidth_limit_down,
       session_timeout, idle_timeout, daily_limit, splash_message, redirect_url, terms_url, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, address, ssid, nas_ip, bandwidth_limit_up || 0, bandwidth_limit_down || 0,
       session_timeout || 3600, idle_timeout || 600, daily_limit || 0,
       splash_message || "", redirect_url || "", terms_url || "", logo_url || ""]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to create location" });
  }
});

app.put("/api/admin/locations/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE locations SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to update location" });
  }
});

// ─── Sessions ───
app.get("/api/admin/sessions", authMiddleware, async (req, res) => {
  try {
    const { status = "all", page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT s.*, g.email, g.phone, g.name as guest_name, l.name as location_name
                 FROM sessions s
                 LEFT JOIN guests g ON s.guest_id = g.id
                 LEFT JOIN locations l ON s.location_id = l.id`;
    const params = [];

    if (status !== "all") {
      query += " WHERE s.status = $1";
      params.push(status);
    }

    query += ` ORDER BY s.started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// ─── Disconnect a user (remove RADIUS auth) ───
app.post("/api/admin/disconnect/:mac", authMiddleware, async (req, res) => {
  try {
    const mac = req.params.mac.toLowerCase().replace(/[^a-f0-9]/g, "");
    const formattedMac = mac.match(/.{2}/g)?.join(":") || mac;

    await pool.query("DELETE FROM radcheck WHERE username = $1", [formattedMac]);
    await pool.query("DELETE FROM radreply WHERE username = $1", [formattedMac]);
    await pool.query("DELETE FROM radusergroup WHERE username = $1", [formattedMac]);
    await pool.query(
      "UPDATE sessions SET status = 'disconnected', ended_at = NOW() WHERE mac_address = $1 AND status = 'active'",
      [formattedMac]
    );

    res.json({ success: true, message: `Disconnected ${formattedMac}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to disconnect user" });
  }
});

// ─── RADIUS Accounting Webhook (CoA) ───
app.post("/api/radius/accounting", async (req, res) => {
  try {
    const { username, acct_status_type, session_id, session_time, input_octets, output_octets } = req.body;

    if (acct_status_type === "Stop") {
      await pool.query(
        `UPDATE sessions SET
          status = 'expired',
          ended_at = NOW(),
          duration_seconds = $2,
          data_up_mb = $3,
          data_down_mb = $4,
          session_id = $5
         WHERE mac_address = $1 AND status = 'active'`,
        [username, session_time || 0, (input_octets || 0) / 1048576, (output_octets || 0) / 1048576, session_id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Accounting update failed" });
  }
});

// ─── Health Check ───
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: "error", message: "Database connection failed" });
  }
});

// ─── Start Server ───
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Captive Portal API running on port ${PORT}`);
});
