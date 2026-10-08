import { query } from './db';

/** Records who changed what. A control on error as much as on misconduct. */
export async function audit(userId, action, entity, entityId = null, detail = null) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, action, entity, entityId ? String(entityId) : null, detail]
    );
  } catch (err) {
    // auditing must never break the operation it is recording
    console.error('audit failed:', err.message);
  }
}
