-- ============================================
-- Captive Portal Database Schema
-- FreeRADIUS tables + Custom portal tables
-- ============================================

-- ─── FreeRADIUS Standard Tables ───

CREATE TABLE IF NOT EXISTS radcheck (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX idx_radcheck_username ON radcheck(username);

CREATE TABLE IF NOT EXISTS radreply (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX idx_radreply_username ON radreply(username);

CREATE TABLE IF NOT EXISTS radgroupcheck (
    id SERIAL PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX idx_radgroupcheck_groupname ON radgroupcheck(groupname);

CREATE TABLE IF NOT EXISTS radgroupreply (
    id SERIAL PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX idx_radgroupreply_groupname ON radgroupreply(groupname);

CREATE TABLE IF NOT EXISTS radusergroup (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_radusergroup_username ON radusergroup(username);

CREATE TABLE IF NOT EXISTS radacct (
    radacctid BIGSERIAL PRIMARY KEY,
    acctsessionid VARCHAR(64) NOT NULL DEFAULT '',
    acctuniqueid VARCHAR(32) NOT NULL DEFAULT '',
    username VARCHAR(64) NOT NULL DEFAULT '',
    realm VARCHAR(64) DEFAULT '',
    nasipaddress VARCHAR(15) NOT NULL DEFAULT '',
    nasportid VARCHAR(32) DEFAULT NULL,
    nasporttype VARCHAR(32) DEFAULT NULL,
    acctstarttime TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    acctupdatetime TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    acctstoptime TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    acctinterval INTEGER DEFAULT NULL,
    acctsessiontime INTEGER DEFAULT NULL,
    acctauthentic VARCHAR(32) DEFAULT NULL,
    connectinfo_start VARCHAR(128) DEFAULT NULL,
    connectinfo_stop VARCHAR(128) DEFAULT NULL,
    acctinputoctets BIGINT DEFAULT NULL,
    acctoutputoctets BIGINT DEFAULT NULL,
    calledstationid VARCHAR(50) NOT NULL DEFAULT '',
    callingstationid VARCHAR(50) NOT NULL DEFAULT '',
    acctterminatecause VARCHAR(32) NOT NULL DEFAULT '',
    servicetype VARCHAR(32) DEFAULT NULL,
    framedprotocol VARCHAR(32) DEFAULT NULL,
    framedipaddress VARCHAR(15) NOT NULL DEFAULT '',
    framedipv6address VARCHAR(45) NOT NULL DEFAULT '',
    framedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
    framedinterfaceid VARCHAR(44) NOT NULL DEFAULT '',
    delegatedipv6prefix VARCHAR(45) NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_radacct_acctuniqueid ON radacct(acctuniqueid);
CREATE INDEX idx_radacct_username ON radacct(username);
CREATE INDEX idx_radacct_acctsessionid ON radacct(acctsessionid);
CREATE INDEX idx_radacct_acctstarttime ON radacct(acctstarttime);
CREATE INDEX idx_radacct_acctstoptime ON radacct(acctstoptime);
CREATE INDEX idx_radacct_nasipaddress ON radacct(nasipaddress);

CREATE TABLE IF NOT EXISTS radpostauth (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    pass VARCHAR(64) NOT NULL DEFAULT '',
    reply VARCHAR(32) NOT NULL DEFAULT '',
    authdate TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_radpostauth_username ON radpostauth(username);

CREATE TABLE IF NOT EXISTS nas (
    id SERIAL PRIMARY KEY,
    nasname VARCHAR(128) NOT NULL,
    shortname VARCHAR(32),
    type VARCHAR(30) DEFAULT 'other',
    ports INTEGER,
    secret VARCHAR(60) DEFAULT 'secret' NOT NULL,
    server VARCHAR(64),
    community VARCHAR(50),
    description VARCHAR(200) DEFAULT 'RADIUS Client'
);
CREATE INDEX idx_nas_nasname ON nas(nasname);

-- ─── Custom Portal Tables ───

-- Locations / Venues
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    ssid VARCHAR(64),
    nas_ip VARCHAR(15),
    bandwidth_limit_up INTEGER DEFAULT 0,    -- Kbps, 0 = unlimited
    bandwidth_limit_down INTEGER DEFAULT 0,  -- Kbps, 0 = unlimited
    session_timeout INTEGER DEFAULT 3600,    -- seconds
    idle_timeout INTEGER DEFAULT 600,        -- seconds
    daily_limit INTEGER DEFAULT 0,           -- MB, 0 = unlimited
    splash_message TEXT DEFAULT 'Welcome! Connect to free WiFi.',
    redirect_url VARCHAR(512) DEFAULT '',
    terms_url VARCHAR(512) DEFAULT '',
    logo_url VARCHAR(512) DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Guest Users (people connecting to WiFi)
CREATE TABLE IF NOT EXISTS guests (
    id SERIAL PRIMARY KEY,
    mac_address VARCHAR(17) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    name VARCHAR(255),
    auth_method VARCHAR(20) DEFAULT 'email', -- email, phone, social, click-through
    location_id INTEGER REFERENCES locations(id),
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    visit_count INTEGER DEFAULT 1,
    total_data_mb NUMERIC(10,2) DEFAULT 0,
    total_time_seconds INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_guests_mac ON guests(mac_address);
CREATE INDEX idx_guests_email ON guests(email);
CREATE INDEX idx_guests_location ON guests(location_id);

-- Sessions (active/past WiFi sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    guest_id INTEGER REFERENCES guests(id),
    location_id INTEGER REFERENCES locations(id),
    mac_address VARCHAR(17) NOT NULL,
    ip_address VARCHAR(45),
    nas_ip VARCHAR(15),
    session_id VARCHAR(64),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    data_up_mb NUMERIC(10,2) DEFAULT 0,
    data_down_mb NUMERIC(10,2) DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' -- active, expired, disconnected
);
CREATE INDEX idx_sessions_guest ON sessions(guest_id);
CREATE INDEX idx_sessions_mac ON sessions(mac_address);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Admin Users (dashboard access)
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(20) DEFAULT 'admin', -- admin, viewer
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── Default Data ───

-- Default location
INSERT INTO locations (name, address, ssid, nas_ip, splash_message)
VALUES ('Default Venue', '123 Main St', 'FreeWiFi', '0.0.0.0', 'Welcome! Enjoy free WiFi.');

-- Default admin (password: admin123 - CHANGE THIS!)
-- bcrypt hash of 'admin123'
INSERT INTO admins (email, password_hash, name, role)
VALUES ('admin@portal.local', '$2b$10$rQ7p6n5e5y5n5e5y5n5e5uJK8WzN5D5x5D5x5D5x5D5x5D5x5D', 'Admin', 'admin');

-- Default RADIUS group with session limits
INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ('guests', 'Session-Timeout', ':=', '3600');
INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES ('guests', 'Idle-Timeout', ':=', '600');
INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES ('guests', 'Reply-Message', '=', 'Welcome to Free WiFi');
