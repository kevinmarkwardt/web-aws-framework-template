/** Page archetypes: starting points for the public site's pages, chosen per page in site.spec.yaml
 *  (`pages[].archetype`). They are layouts, not designs: every color, font, radius and spacing comes from the theme
 *  tokens (theme.css), and each archetype has structural variants so three design directions can differ in layout,
 *  not only in palette. Data comes in through props, so they render mocks (MSW) and real API data the same way.
 *
 *  archetype (spec)  -> component
 *  landing           -> Hero + FeatureGrid / Showcase / StatsBand / Testimonials / CtaBand
 *  browse            -> Browse (+ EntityCard / EntityRow)
 *  detail            -> Detail
 *  dashboard         -> DashboardArchetype + DashboardPanel
 *  form              -> FormArchetype
 *  pricing           -> PricingArchetype
 *  static / legal    -> ProseArchetype (+ Faq)
 *  wallet / account / settings -> the template's own pages (frontend/src/pages/dashboard), restyled by tokens
 *
 *  Every page gets the shell: SiteHeader on top, the app's SiteFooter below. */
export {
  ActionButton, Breadcrumbs, Container, EmptyState, EntityCard, EntityRow, ErrorState, Media, MetaList, Section,
  SectionHeader, SkeletonGrid, SmartLink, Tag,
} from './parts';
export type { Action, Crumb, Meta, Width } from './parts';
export { SiteHeader } from './SiteHeader';
export type { NavItem } from './SiteHeader';
export { CtaBand, FeatureGrid, Hero, Showcase, StatsBand, Testimonials } from './Landing';
export type { Feature } from './Landing';
export { Browse, Pagination } from './Browse';
export type { BrowseView, Filter, FilterOption, SortOption } from './Browse';
export { Detail } from './Detail';
export { DashboardArchetype, DashboardPanel, Faq, FormArchetype, PricingArchetype, ProseArchetype } from './Pages';
export type { FormSection, PricingPlan } from './Pages';
