import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { useTranslation } from '@yourapp/shared';
import { creditsOn, subscriptionsOn, units, usd, usePublicConfig } from '../billing';
import { itemsLabel } from '../plans';

// title and description are i18n keys (landing.json), translated when rendering
const features = [
  {
    title: 'landing.features.monitoring.title',
    description: 'landing.features.monitoring.description',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    title: 'landing.features.alerts.title',
    description: 'landing.features.alerts.description',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
    ),
  },
  {
    title: 'landing.features.organize.title',
    description: 'landing.features.organize.description',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
      </svg>
    ),
  },
  {
    title: 'landing.features.digest.title',
    description: 'landing.features.digest.description',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    title: 'landing.features.insights.title',
    description: 'landing.features.insights.description',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    ),
  },
  {
    title: 'landing.features.reports.title',
    description: 'landing.features.reports.description',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  // Plans, prices, limits and credit packs come from the API (api/lib/config.py; limits are admin-editable). The
  // pricing section shows the billing modules that are on, and nothing until the API answers.
  const config = usePublicConfig();
  const plans = subscriptionsOn(config?.billingMode) ? config?.plans ?? [] : [];
  const credits = creditsOn(config?.billingMode) ? config?.credits : undefined;
  const freeLimit = config?.planLimits?.free;
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-7 h-7 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span className="text-xl font-bold text-gray-900">YourApp</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              {t('landing.nav.login')}
            </Link>
            <Link
              to="/signup"
              className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg transition-colors"
            >
              {t('landing.getStarted')}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-20 pb-16 sm:pt-28 sm:pb-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 tracking-tight">
            {t('landing.hero.title')}<br />
            <span className="text-brand-600">{t('landing.hero.titleAccent')}</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto">
            {t('landing.hero.body')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/signup"
              className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors shadow-sm"
            >
              {t('landing.hero.start')}
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors border border-gray-300"
            >
              {t('landing.hero.viewPricing')}
            </a>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            {freeLimit !== undefined && t('landing.hero.freeIncludes', { items: itemsLabel(freeLimit).toLowerCase() })}
            {t('landing.hero.noCard')}
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">
              {t('landing.features.title')}
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              {t('landing.features.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div key={feature.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t(feature.title)}</h3>
                <p className="text-gray-600">{t(feature.description)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-16">{t('landing.how.title')}</h2>
          <div className="space-y-12">
            {[
              {
                step: '1',
                title: t('landing.how.add.title'),
                desc: t('landing.how.add.desc'),
              },
              {
                step: '2',
                title: t('landing.how.check.title'),
                desc: t('landing.how.check.desc'),
              },
              {
                step: '3',
                title: t('landing.how.alert.title'),
                desc: t('landing.how.alert.desc'),
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-6 items-start">
                <div className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold shrink-0">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">{item.title}</h3>
                  <p className="mt-2 text-gray-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      {(plans.length > 0 || credits) && (
        <section id="pricing" className="py-16 sm:py-24 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900">{t('landing.pricing.title')}</h2>
              <p className="mt-4 text-lg text-gray-600">{t('landing.pricing.subtitle')}</p>
            </div>
            {plans.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {plans.map((plan, i) => (
                  <div key={plan.id} className={`rounded-2xl p-8 flex flex-col bg-white ${i === 1 ? 'ring-2 ring-brand-600 shadow-lg' : 'border border-gray-200 shadow-sm'}`}>
                    <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-gray-900">{t('landing.pricing.price', { amount: plan.monthlyUsd })}</span>
                      <span className="text-gray-500">{t('landing.pricing.perMonth')}</span>
                    </div>
                    <Link to="/signup" className="mt-6 block text-center py-2.5 px-4 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700">
                      {plan.monthlyUsd === 0 ? t('landing.pricing.startFree') : t('landing.pricing.choose', { plan: plan.name })}
                    </Link>
                    <ul className="mt-8 space-y-3 flex-1">
                      {[itemsLabel(plan.limits.items ?? null), ...(plan.features ?? [])].map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                          <svg className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {credits && (
              <div className="mt-12 max-w-3xl mx-auto text-center">
                <h3 className="text-xl font-semibold text-gray-900">{t('landing.pricing.payg.title')}</h3>
                <p className="mt-2 text-gray-600">
                  {credits.signupGift > 0
                    ? t('landing.pricing.payg.buyWithGift', {
                      credits: credits.creditName,
                      perDollar: credits.perDollar,
                      gift: units(credits.signupGift, credits.creditName),
                    })
                    : t('landing.pricing.payg.buy', { credits: credits.creditName, perDollar: credits.perDollar })}{' '}
                  {t('landing.pricing.payg.refund', { credits: credits.creditName, count: credits.refundDays })}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {credits.packs.map((p) => (
                    <div key={p.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                      <p className="font-semibold text-gray-900">{usd(p.payCents)}</p>
                      <p className="text-sm text-gray-600">{units(p.credits, credits.creditName)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900">{t('landing.cta.title')}</h2>
          <p className="mt-4 text-lg text-gray-600">
            {t('landing.cta.body')}
          </p>
          <Link
            to="/signup"
            className="mt-8 inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors shadow-sm"
          >
            {t('landing.getStarted')}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
