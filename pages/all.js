// All case comps: every host and tier, startup contests labelled, text
// search over title and host, sorted by deadline.
import { TIERS } from '../lib/data.js';
import { startListPage } from '../lib/listpage.js';

startListPage({ page: 'all', tiers: Object.keys(TIERS), startups: true, search: true, allowAdd: false, sort: true });
