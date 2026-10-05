// The API's database handle over a node-postgres Pool: tx(fn) runs fn in
// one transaction on one pooled connection (logged in as radar_api, from
// DATABASE_URL). `set local` settings (role, app.email, statement_timeout)
// end with the transaction, so a connection goes back to the pool clean.
export function poolDb(pool) {
  return {
    async tx(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query('begin');
        const out = await fn({ query: (sql, params) => client.query(sql, params) });
        await client.query('commit');
        return out;
      } catch (e) {
        try { await client.query('rollback'); } catch { broken = true; }
        throw e;
      } finally {
        // A connection that could not even roll back is dropped, not reused.
        client.release(broken || undefined);
      }
    },
  };
}
