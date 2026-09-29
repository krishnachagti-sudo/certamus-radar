// Board: top hosts, case competitions only, v1 order.
import { BOARD_TIERS } from '../lib/data.js';
import { startListPage } from '../lib/listpage.js';

startListPage({ page: 'board', tiers: BOARD_TIERS, startups: false, search: false, allowAdd: true, sort: false });
