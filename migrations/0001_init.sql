CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  tier TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  bill_code TEXT NOT NULL UNIQUE,
  paid_at TEXT,
  zoom_sent TEXT
);

CREATE INDEX idx_registrations_email ON registrations(email);
CREATE INDEX idx_registrations_bill_code ON registrations(bill_code);
