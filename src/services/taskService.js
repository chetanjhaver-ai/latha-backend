// Task Management's data operations — ported from the Apps Script version.
// No role restrictions here, matching the original tool: anyone logged in
// can manage employees and tasks.

async function readAll(db) {
  const [emp, tasks, updates] = await Promise.all([
    db.query(`SELECT id, name, phone, role, active FROM tm_employees ORDER BY created_at`),
    db.query(`SELECT id, employee_id, title, allotted_date, due_date, priority, status, created_at FROM tm_tasks ORDER BY created_at`),
    db.query(`SELECT id, task_id, date, note, status_at_update FROM tm_updates ORDER BY date DESC, created_at DESC`),
  ]);
  return {
    employees: emp.rows.map(r => ({ id: r.id, name: r.name, phone: r.phone, role: r.role, active: r.active })),
    tasks: tasks.rows.map(r => ({
      id: r.id, employeeId: r.employee_id, title: r.title,
      allottedDate: r.allotted_date.toISOString().slice(0, 10),
      dueDate: r.due_date ? r.due_date.toISOString().slice(0, 10) : '',
      priority: r.priority, status: r.status, createdAt: r.created_at,
    })),
    updates: updates.rows.map(r => ({
      id: r.id, taskId: r.task_id, date: r.date.toISOString().slice(0, 10),
      note: r.note, statusAtUpdate: r.status_at_update,
    })),
  };
}

// ---- Employees ----
async function addEmployee(db, { name, phone, role }) {
  const { rows } = await db.query(
    `INSERT INTO tm_employees (name, phone, role) VALUES ($1,$2,$3) RETURNING id`,
    [name || 'New employee', phone || '', role || '']
  );
  return rows[0].id;
}
const EMP_FIELD_COLUMN = { name: 'name', phone: 'phone', role: 'role' };
async function updateEmployeeField(db, id, field, value) {
  const col = EMP_FIELD_COLUMN[field];
  if (!col) throw new Error('Unknown employee field: ' + field);
  await db.query(`UPDATE tm_employees SET ${col} = $2 WHERE id = $1`, [id, value]);
}
async function deleteEmployee(db, id) {
  await db.query(`DELETE FROM tm_employees WHERE id = $1`, [id]);
  // tasks referencing this employee simply become "unassigned" — matches
  // the original tool's behaviour of not cascading employee deletes.
}

// ---- Tasks ----
async function createTask(db, { employeeId, title, allottedDate, dueDate, priority }) {
  const { rows } = await db.query(
    `INSERT INTO tm_tasks (employee_id, title, allotted_date, due_date, priority, status)
     VALUES ($1,$2,$3,$4,$5,'Open') RETURNING id`,
    [employeeId, title, allottedDate, dueDate || null, priority || 'Normal']
  );
  return rows[0].id;
}

async function updateTask(db, id, { employeeId, title, allottedDate, dueDate, priority, status }) {
  const { rows: existingRows } = await db.query(`SELECT status FROM tm_tasks WHERE id = $1`, [id]);
  const existing = existingRows[0];
  if (!existing) throw new Error('Task not found');
  const statusChanged = status && status !== existing.status;

  await db.query(
    `UPDATE tm_tasks SET employee_id=$2, title=$3, allotted_date=$4, due_date=$5, priority=$6, status=$7 WHERE id=$1`,
    [id, employeeId, title, allottedDate, dueDate || null, priority || 'Normal', status || existing.status]
  );

  if (statusChanged) {
    await db.query(
      `INSERT INTO tm_updates (task_id, date, note, status_at_update) VALUES ($1, CURRENT_DATE, $2, $3)`,
      [id, `Status changed to ${status}.`, status]
    );
  }
}

async function markDone(db, id) {
  await db.query(`UPDATE tm_tasks SET status = 'Done' WHERE id = $1`, [id]);
  await db.query(
    `INSERT INTO tm_updates (task_id, date, note, status_at_update) VALUES ($1, CURRENT_DATE, 'Marked done.', 'Done')`,
    [id]
  );
}

async function deleteTask(db, id) {
  // ON DELETE CASCADE on tm_updates.task_id removes its update history too.
  await db.query(`DELETE FROM tm_tasks WHERE id = $1`, [id]);
}

// ---- Updates ----
async function addUpdate(db, { taskId, date, note, status }) {
  const finalNote = note || (status ? `Status changed to ${status}.` : '');
  const { rows } = await db.query(
    `INSERT INTO tm_updates (task_id, date, note, status_at_update) VALUES ($1,$2,$3,$4) RETURNING id`,
    [taskId, date, finalNote, status || '']
  );
  if (status) await db.query(`UPDATE tm_tasks SET status = $2 WHERE id = $1`, [taskId, status]);
  return rows[0].id;
}

module.exports = {
  readAll, addEmployee, updateEmployeeField, deleteEmployee,
  createTask, updateTask, markDone, deleteTask, addUpdate,
};
