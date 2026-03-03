import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Automated Monitoring',
    description:
      'Set it and forget it. Your items are checked on a schedule and you are alerted the moment something changes.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    title: 'Instant Alerts',
    description:
      'Get notified the same day something changes. No more discovering issues days or weeks after they happen.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
    ),
  },
  {
    title: 'Organize Everything',
    description:
      'Add tags, notes, and metadata to your items. Filter and search across your entire collection instantly.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
      </svg>
    ),
  },
  {
    title: 'Weekly Digest',
    description:
      'Every week, get a summary of what changed, what is healthy, and what needs your attention.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    title: 'AI-Powered Insights',
    description:
      'Pro users get AI-powered analysis and recommendations based on their data trends.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    ),
  },
  {
    title: 'Monthly Reports',
    description:
      'Pro users receive a monthly summary report with trends, breakdowns, and historical comparisons.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
  },
];

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Get started and see if it fits your workflow.',
    features: [
      '10 monitored items',
      'Daily check frequency',
      'Instant status change alerts',
      'Weekly digest',
      'Data retained forever',
    ],
    notIncluded: ['AI-powered insights', 'Monthly PDF report'],
    cta: 'Get Started Free',
    href: '/signup',
    highlighted: false,
  },
  {
    name: 'Starter',
    price: '$9',
    period: '/month',
    description: 'For individuals managing an active workload.',
    features: [
      '100 monitored items',
      'Daily check frequency',
      'Instant status change alerts',
      'Weekly digest',
      'Data retained forever',
    ],
    notIncluded: ['AI-powered insights', 'Monthly PDF report'],
    cta: 'Start with Starter',
    href: '/signup',
    highlighted: true,
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For teams and power users who need full visibility.',
    features: [
      'Unlimited monitored items',
      'Hourly check frequency',
      'Instant status change alerts',
      'Weekly digest',
      'AI-powered insights',
      'Monthly PDF report',
      'Data retained forever',
    ],
    notIncluded: [],
    cta: 'Go Pro',
    href: '/signup',
    highlighted: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span className="text-xl font-bold text-gray-900">YourApp</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Log in
            </Link>
            <Link
              to="/signup"
              className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-20 pb-16 sm:pt-28 sm:pb-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 tracking-tight">
            Track Everything.<br />
            <span className="text-indigo-600">Know When It Changes.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto">
            Monitor your items on a schedule. Get instant alerts when status changes.
            A simple, focused tool that stays out of your way.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/signup"
              className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
            >
              Start Monitoring Free
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors border border-gray-300"
            >
              View Pricing
            </a>
          </div>
          <p className="mt-4 text-sm text-gray-500">Free plan includes 10 items. No credit card required.</p>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">
              Everything you need to stay on top of your data
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              One focused tool. No bloat.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div key={feature.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-16">How it works</h2>
          <div className="space-y-12">
            {[
              {
                step: '1',
                title: 'Add your items',
                desc: 'Add items individually or in bulk. Include a URL, a label, and any notes you want to track.',
              },
              {
                step: '2',
                title: 'We check them on a schedule',
                desc: 'Your items are checked daily (or hourly on Pro). We detect status changes and record the history.',
              },
              {
                step: '3',
                title: 'Get alerted instantly',
                desc: 'The moment an item changes status, you get an email. Every week, you get a full digest of what is healthy and what is not.',
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-6 items-start">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold shrink-0">
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
      <section id="pricing" className="py-16 sm:py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">Simple, transparent pricing</h2>
            <p className="mt-4 text-lg text-gray-600">
              Start free. Upgrade when you need more.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl p-8 flex flex-col ${
                  tier.highlighted
                    ? 'bg-white ring-2 ring-indigo-600 shadow-lg relative'
                    : 'bg-white border border-gray-200 shadow-sm'
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{tier.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-gray-900">{tier.price}</span>
                  <span className="text-gray-500">{tier.period}</span>
                </div>
                <p className="mt-3 text-sm text-gray-600">{tier.description}</p>
                <Link
                  to={tier.href}
                  className={`mt-6 block text-center py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors ${
                    tier.highlighted
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'
                  }`}
                >
                  {tier.cta}
                </Link>
                <ul className="mt-8 space-y-3 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                      <svg className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                  {tier.notIncluded.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-400">
                      <svg className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Start tracking in under 60 seconds</h2>
          <p className="mt-4 text-lg text-gray-600">
            Free plan available. No credit card required.
          </p>
          <Link
            to="/signup"
            className="mt-8 inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
          >
            Get Started Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span className="text-sm text-gray-500">YourApp</span>
          </div>
          <p className="text-sm text-gray-400">yourapp.com</p>
        </div>
      </footer>
    </div>
  );
}
