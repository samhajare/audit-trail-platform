CREATE TABLE audit_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       VARCHAR(128) NOT NULL UNIQUE,          -- idempotency key
  schema_version VARCHAR(16)  NOT NULL,
  event_type     VARCHAR(100) NOT NULL,
  action         VARCHAR(100) NOT NULL,
  actor_id       VARCHAR(128) NOT NULL,
  actor_email    VARCHAR(255),
  actor_role     VARCHAR(64),
  resource_type  VARCHAR(64),
  resource_id    VARCHAR(128),
  service_name   VARCHAR(100) NOT NULL,
  tenant_id      VARCHAR(100) NOT NULL,
  severity       VARCHAR(16)  NOT NULL,
  correlation_id VARCHAR(128),
  ip_address     VARCHAR(64),
  user_agent     VARCHAR(512),
  before_data    JSONB,
  after_data     JSONB,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload    JSONB NOT NULL,                        -- original event; only returned to audit:view-sensitive
  occurred_at    TIMESTAMPTZ NOT NULL,                  -- when it happened (producer clock)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),    -- when we ingested it
  CONSTRAINT chk_severity CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL'))
);

-- Every read is tenant-scoped, so tenant_id leads the composite indexes.
CREATE INDEX idx_audit_tenant_time     ON audit_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX idx_audit_tenant_type     ON audit_events (tenant_id, event_type, occurred_at DESC);
CREATE INDEX idx_audit_tenant_severity ON audit_events (tenant_id, severity, occurred_at DESC);
CREATE INDEX idx_audit_actor           ON audit_events (actor_id);
CREATE INDEX idx_audit_correlation     ON audit_events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_resource        ON audit_events (resource_type, resource_id);
CREATE INDEX idx_audit_created_at      ON audit_events (created_at);

-- Materialised view of the DLQ topic (the topic stays the source of truth).
CREATE TABLE failed_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      VARCHAR(128),
  event_type    VARCHAR(100),
  tenant_id     VARCHAR(100),          -- NULL when the payload was unparseable (poison message)
  payload       TEXT NOT NULL,
  error         TEXT NOT NULL,
  retry_count   INT  NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'FAILED' CHECK (status IN ('FAILED','REPLAYED')),
  dlq_partition INT  NOT NULL,
  dlq_offset    BIGINT NOT NULL,
  failed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at   TIMESTAMPTZ,
  replayed_by   VARCHAR(128),
  UNIQUE (dlq_partition, dlq_offset)   -- makes the DLQ indexer idempotent
);
CREATE INDEX idx_failed_tenant ON failed_events (tenant_id, status, failed_at DESC);
