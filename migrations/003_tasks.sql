-- Phase 3: Task Management's data, as real tables instead of a Google Sheet.
-- No admin/user distinction needed here — anyone logged in can manage tasks,
-- same as the original tool.

CREATE TABLE IF NOT EXISTS tm_employees (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT DEFAULT '',
  role       TEXT DEFAULT '',   -- job title / team, not an auth role
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tm_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID REFERENCES tm_employees(id),
  title         TEXT NOT NULL,
  allotted_date DATE NOT NULL,
  due_date      DATE,
  priority      TEXT NOT NULL DEFAULT 'Normal',
  status        TEXT NOT NULL DEFAULT 'Open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tm_updates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tm_tasks(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  note             TEXT DEFAULT '',
  status_at_update TEXT DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tm_updates_task ON tm_updates(task_id);
