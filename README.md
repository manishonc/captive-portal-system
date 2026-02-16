# Captive Portal — SocialWiFi-style

A self-hosted captive portal system with FreeRADIUS, Next.js splash page, and REST API.
Built for **Aruba Instant On AP-21** (External Captive Portal mode).

## Architecture

```
┌───────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   Guest WiFi  │──────▶│  Aruba AP-21     │──────▶│  FreeRADIUS      │
│   Device      │       │  (Instant On)    │       │  :1812/1813 UDP  │
└───────────────┘       └────────┬─────────┘       └────────┬─────────┘
                                 │                          │
                        Redirect to                   PostgreSQL
                        External Portal                    │
                                 │                          │
                        ┌────────▼─────────┐       ┌───────▼──────────┐
                        │  Next.js Portal  │──────▶│  API Server      │
                        │  :3000           │       │  :4000           │
                        │  (Splash Page)   │       │  (Auth + Admin)  │
                        └──────────────────┘       └──────────────────┘
```

## Flow

1. Guest connects to your WiFi SSID
2. Aruba AP redirects to your external captive portal (`http://YOUR_VPS:3000`)
3. Guest enters email/phone on the splash page
4. Portal calls API → API creates RADIUS user credentials
5. Portal auto-submits credentials back to Aruba's login URL
6. Aruba authenticates via FreeRADIUS → Guest gets internet access
7. Sessions tracked, data collected for analytics

## Quick Start

### 1. Clone & Configure

```bash
cp .env.example .env
# Edit .env with your VPS IP and secrets
nano .env
```

### 2. Deploy

```bash
docker-compose up -d
```

### 3. Verify

```bash
# Check all services are running
docker-compose ps

# Test API
curl http://localhost:4000/api/health

# Test RADIUS (install radtest: apt install freeradius-utils)
radtest testuser testpass localhost 0 testing123
```

## Aruba Instant On AP-21 Configuration

### Step 1: Login to Aruba Instant On Portal
- Go to https://portal.arubainstanton.com
- Select your site / network

### Step 2: Create Guest Network
1. Go to **Networks** → **+ Create Network**
2. Settings:
   - **Name (SSID):** `FreeWiFi` (or whatever you want)
   - **Usage:** Guest
   - **Security:** Open (captive portal handles auth)

### Step 3: Configure External Captive Portal
1. In your guest network settings, find **Captive Portal** section
2. Select **External Captive Portal**
3. Configure:
   - **Portal URL:** `http://YOUR_VPS_IP:3000`
   - **Redirect URL:** (optional) Where to send users after auth
   - **Allowed URLs (Walled Garden):** Add your VPS IP so guests can reach the portal
     - `YOUR_VPS_IP` (both IP and any domain you use)

### Step 4: Configure RADIUS Server
1. Go to **Security** → **Authentication Servers**
2. Add RADIUS Server:
   - **Server IP:** `YOUR_VPS_IP`
   - **Authentication Port:** `1812`
   - **Accounting Port:** `1813`
   - **Shared Secret:** `testing123` (match your .env RADIUS_SECRET)
3. Assign this RADIUS server to your guest network

### Step 5: Walled Garden
Add these to the walled garden (allowed before auth):
- Your VPS IP address
- Your domain (if using one)
- Any CDN URLs for your portal assets

## API Reference

### Public Endpoints (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/guest` | Authenticate a guest (main portal endpoint) |
| GET | `/api/auth/status/:mac` | Check if MAC is authorized |
| GET | `/api/location/:id` | Get location/splash info |
| GET | `/api/health` | Health check |

### Admin Endpoints (JWT Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Admin login → JWT token |
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/guests` | List guests (paginated, searchable) |
| GET | `/api/admin/locations` | List locations |
| POST | `/api/admin/locations` | Create location |
| PUT | `/api/admin/locations/:id` | Update location |
| GET | `/api/admin/sessions` | List sessions |
| POST | `/api/admin/disconnect/:mac` | Disconnect a user |

### Guest Auth Request

```bash
curl -X POST http://localhost:4000/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{
    "mac_address": "aa:bb:cc:dd:ee:ff",
    "email": "guest@example.com",
    "auth_method": "email",
    "location_id": 1
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "username": "aa:bb:cc:dd:ee:ff",
    "password": "a1b2c3d4e5f6g7h8",
    "session_timeout": 3600,
    "redirect_url": ""
  }
}
```

## Production Checklist

- [ ] Change all default passwords in `.env`
- [ ] Use HTTPS (add nginx reverse proxy with Let's Encrypt)
- [ ] Restrict RADIUS client IPs in `clients.conf` to your Aruba AP only
- [ ] Set up firewall: only allow 1812/1813 UDP from your AP's IP
- [ ] Set up proper admin password (hash with bcrypt)
- [ ] Add rate limiting to API
- [ ] Configure backup for PostgreSQL
- [ ] Set bandwidth limits per location
- [ ] Add your logo and branding to the portal

## Adding HTTPS (Recommended)

```bash
# Install certbot
apt install certbot

# Get certificate for your domain
certbot certonly --standalone -d wifi.yourdomain.com

# Add nginx reverse proxy (see nginx/ folder for config)
```

## File Structure

```
captive-portal/
├── docker-compose.yml          # Main orchestration
├── .env.example                # Environment variables template
├── db/
│   └── init.sql                # Database schema (RADIUS + custom)
├── freeradius/
│   ├── Dockerfile
│   └── raddb/
│       ├── clients.conf        # RADIUS clients (your Aruba AP)
│       ├── sites-enabled/
│       │   └── default         # Virtual server config
│       └── mods-enabled/
│           └── sql             # PostgreSQL connection
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js               # Express API server
└── portal/
    ├── Dockerfile
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    └── app/
        ├── layout.js
        ├── globals.css
        └── page.js             # Captive portal splash page
```

## Troubleshooting

**RADIUS not authenticating:**
```bash
# Check RADIUS logs
docker logs captive-freeradius

# Test with radtest
radtest "aa:bb:cc:dd:ee:ff" "password" YOUR_VPS_IP 0 testing123
```

**Portal not loading:**
- Ensure VPS IP is in Aruba's Walled Garden
- Check firewall allows port 3000 from guest network
- Verify DNS resolution if using a domain

**Database issues:**
```bash
# Connect to DB
docker exec -it captive-postgres psql -U radius -d captive_portal

# Check RADIUS users
SELECT * FROM radcheck;

# Check guests
SELECT * FROM guests ORDER BY created_at DESC LIMIT 10;
```
