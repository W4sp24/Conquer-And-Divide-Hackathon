-- Generated from api/app/schema.py by api/scripts/export_schema.py. Do not edit by hand.
-- Run once in the Supabase SQL editor. The backend also creates missing tables on startup.
-- Money is whole centavos. Timestamps are stored as UTC.

CREATE TABLE sellers (
	id VARCHAR(36) NOT NULL, 
	name TEXT NOT NULL, 
	shop_name TEXT NOT NULL, 
	payment_mode VARCHAR(16) NOT NULL, 
	wallet_provider TEXT, 
	wallet_name TEXT, 
	wallet_number TEXT, 
	auto_release_gateway BOOLEAN NOT NULL, 
	hold_minutes INTEGER NOT NULL, 
	pay_window_hours INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE buyers (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	platform_user_id TEXT NOT NULL, 
	display_name TEXT NOT NULL, 
	claims INTEGER NOT NULL, 
	verified INTEGER NOT NULL, 
	failed_proofs INTEGER NOT NULL, 
	expired_unpaid INTEGER NOT NULL, 
	cancels INTEGER NOT NULL, 
	max_paid_centavos INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_buyer UNIQUE (seller_id, platform_user_id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id)
);

CREATE TABLE catalog_items (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	code VARCHAR(16) NOT NULL, 
	name TEXT NOT NULL, 
	price_centavos INTEGER NOT NULL, 
	sizes JSON NOT NULL, 
	stock INTEGER NOT NULL, 
	keywords JSON NOT NULL, 
	photo_url TEXT, 
	tone VARCHAR(9), 
	active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_item_code UNIQUE (seller_id, code), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id)
);

CREATE TABLE corrections (
	id SERIAL NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	message TEXT NOT NULL, 
	fixed JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id)
);

CREATE TABLE statement_uploads (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	filename TEXT, 
	row_count INTEGER, 
	covers_until TIMESTAMP WITHOUT TIME ZONE, 
	uploaded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id)
);

CREATE TABLE wallet_ledger (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	reference TEXT NOT NULL, 
	amount_centavos INTEGER NOT NULL, 
	sender_name TEXT NOT NULL, 
	message TEXT, 
	paid_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id)
);

CREATE TABLE live_sessions (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	title TEXT NOT NULL, 
	source VARCHAR(16) NOT NULL, 
	live_video_id TEXT, 
	fb_video_url TEXT, 
	replay_speed FLOAT NOT NULL, 
	current_item_id VARCHAR(36), 
	recent_item_ids JSON NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	error TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	started_at TIMESTAMP WITHOUT TIME ZONE, 
	ended_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id), 
	FOREIGN KEY(current_item_id) REFERENCES catalog_items (id)
);

CREATE TABLE comments (
	id VARCHAR(128) NOT NULL, 
	session_id VARCHAR(36) NOT NULL, 
	buyer_id VARCHAR(36), 
	message TEXT NOT NULL, 
	source VARCHAR(16) NOT NULL, 
	created_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	parse_stage VARCHAR(16), 
	parse_result JSON, 
	confidence FLOAT, 
	outcome TEXT, 
	resolved BOOLEAN NOT NULL, 
	received_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES live_sessions (id), 
	FOREIGN KEY(buyer_id) REFERENCES buyers (id)
);

CREATE INDEX comments_session ON comments (session_id, created_time);

CREATE TABLE orders (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	session_id VARCHAR(36) NOT NULL, 
	buyer_id VARCHAR(36) NOT NULL, 
	item_id VARCHAR(36) NOT NULL, 
	comment_id VARCHAR(128), 
	size TEXT, 
	qty INTEGER NOT NULL, 
	unit_price_centavos INTEGER NOT NULL, 
	total_centavos INTEGER NOT NULL, 
	for_name TEXT, 
	status VARCHAR(16) NOT NULL, 
	buyer_token VARCHAR(64) NOT NULL, 
	claimed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	hold_until TIMESTAMP WITHOUT TIME ZONE, 
	pay_by TIMESTAMP WITHOUT TIME ZONE, 
	proof_reference TEXT, 
	proof_amount_centavos INTEGER, 
	proof_submitted_at TIMESTAMP WITHOUT TIME ZONE, 
	proof_attested BOOLEAN NOT NULL, 
	proof_channel VARCHAR(16), 
	verdict VARCHAR(16), 
	verdict_reasons JSON NOT NULL, 
	verdict_suggestion TEXT, 
	seller_note TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id), 
	FOREIGN KEY(session_id) REFERENCES live_sessions (id), 
	FOREIGN KEY(buyer_id) REFERENCES buyers (id), 
	FOREIGN KEY(item_id) REFERENCES catalog_items (id), 
	FOREIGN KEY(comment_id) REFERENCES comments (id), 
	UNIQUE (buyer_token)
);

CREATE INDEX orders_queue ON orders (item_id, status, claimed_at);

CREATE TABLE order_events (
	id SERIAL NOT NULL, 
	order_id VARCHAR(36) NOT NULL, 
	from_status VARCHAR(16), 
	to_status VARCHAR(16) NOT NULL, 
	actor VARCHAR(16) NOT NULL, 
	note TEXT, 
	at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id)
);

CREATE TABLE payment_intents (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	order_id VARCHAR(36) NOT NULL, 
	amount_centavos INTEGER NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	reference TEXT, 
	payer_name TEXT, 
	expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	paid_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id)
);

CREATE TABLE payments (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	source VARCHAR(16) NOT NULL, 
	reference TEXT NOT NULL, 
	amount_centavos INTEGER NOT NULL, 
	paid_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	order_id VARCHAR(36), 
	upload_id VARCHAR(36), 
	PRIMARY KEY (id), 
	CONSTRAINT uq_payment UNIQUE (seller_id, source, reference), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id), 
	FOREIGN KEY(upload_id) REFERENCES statement_uploads (id)
);

CREATE TABLE proofs (
	id VARCHAR(36) NOT NULL, 
	seller_id VARCHAR(36) NOT NULL, 
	order_id VARCHAR(36) NOT NULL, 
	reference TEXT NOT NULL, 
	amount_centavos INTEGER NOT NULL, 
	attested BOOLEAN NOT NULL, 
	submitted_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_proof_reference UNIQUE (seller_id, reference), 
	FOREIGN KEY(seller_id) REFERENCES sellers (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id)
);

-- Only the backend talks to the database. RLS on with no policies blocks
-- Supabase's public REST API from reading anything.
alter table sellers enable row level security;
alter table buyers enable row level security;
alter table catalog_items enable row level security;
alter table corrections enable row level security;
alter table statement_uploads enable row level security;
alter table wallet_ledger enable row level security;
alter table live_sessions enable row level security;
alter table comments enable row level security;
alter table orders enable row level security;
alter table order_events enable row level security;
alter table payment_intents enable row level security;
alter table payments enable row level security;
alter table proofs enable row level security;
