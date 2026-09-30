// All case comps (or all hackathons, ?s=hack): every host and tier, startup
// contests labelled, text search over title and host, sorted by deadline.
import { currentSection, sectionOf } from '../lib/section.js';
import { startListPage } from '../lib/listpage.js';

const sec = sectionOf(currentSection());
startListPage({ page: 'all', tiers: Object.keys(sec.tiers), startups: true, search: true, allowAdd: false, sort: true });
