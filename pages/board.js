// Board: top hosts, v1 order. Case comps only by default; hackathons
// (?s=hack) with their own Board tiers.
import { currentSection, sectionOf } from '../lib/section.js';
import { startListPage } from '../lib/listpage.js';

const sec = sectionOf(currentSection());
startListPage({ page: 'board', tiers: sec.boardTiers, startups: false, search: false, allowAdd: true, sort: false, inbox: true });
