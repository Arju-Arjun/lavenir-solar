import React, { useState, useEffect } from 'react';
import Profile from './C_Profile';
import SiteVisit from './SiteVisit';
import MNREProfile from './MNREProfile';
import PaymentFlow from './PaymentFlow';
import BankLoanView from './BankLoanView';
import Kseb from './Kseb';
import KsebRegistration from './KsebRegistration';
import MNREInstallation from './MNREInstallation';
import DCR from './DCR';
import Services from './Services';
import MaterialDelivery from './MaterialDelivery';
import MaterialInstallation from './MaterialInstallation';

// Links matching workflow nodes
const PROFILE_TABS = [
  { id: 'profile', label: 'PROFILE' },
  { id: 'site-visit', label: 'SITE VISIT' },
  { id: 'mnre-profile', label: 'MNRE PROFILE' },
  { id: 'payment-flow', label: 'PAYMENT FLOW' },
  { id: 'bank-loan', label: 'BANK LOAN' },
  { id: 'kseb', label: 'KSEB FEASIBILITY' },
  { id: 'material-delivery', label: 'MATERIAL DELIVERY' },
  { id: 'installation', label: 'INSTALLATION' },
  { id: 'completion', label: 'KSEB REGISTRATION & COMPLETION' },
  { id: 'dcr', label: 'DCR' },
  { id: 'mnre-installation', label: 'MNRE INSTALLATION' },
  { id: 'service', label: 'SERVICE & MAINTENANCE' }
];

// Maps each tab to the component that renders it, so adding/removing a tab
// only means editing this table instead of a long if-chain in the JSX.
const TAB_COMPONENTS = {
  profile: Profile,
  'site-visit': SiteVisit,
  'mnre-profile': MNREProfile,
  'payment-flow': PaymentFlow,
  'bank-loan': BankLoanView,
  kseb: Kseb,
  'material-delivery': MaterialDelivery,
  installation: MaterialInstallation,
  completion: KsebRegistration,
  dcr: DCR,
  'mnre-installation': MNREInstallation,
  service: Services
};

const VALID_TAB_IDS = new Set(PROFILE_TABS.map((t) => t.id));

export default function CustomerProfile({ customerId }) {
  const [activeTab, setActiveTab] = useState('profile');

  // GUARD: customerId should always be a bare id (e.g. "CUS013"), but if a
  // notification link like /customer-profile/CUS013?tab=mnre-installation
  // is opened and whatever routes to this component extracts the id via a
  // naive path split (instead of a real route param), customerId can arrive
  // here still carrying "?tab=mnre-installation" glued onto it. Every URL
  // this component builds interpolates customerId directly, so an unclean
  // value snowballs into double query strings the moment the user switches
  // tabs, e.g. ".../CUS013?tab=mnre-installation?tab=site-visit".
  //
  // This strips it defensively so the component is safe either way, but the
  // real fix belongs upstream: whatever parses the route/URL to produce this
  // prop should be extracting only the path segment, not the query string.
  const cleanCustomerId =
    typeof customerId === 'string' ? customerId.split('?')[0] : customerId;

  // Keep activeTab in sync with the URL's ?tab= param — on first mount,
  // whenever the customer changes, and on browser back/forward.
  useEffect(() => {
    const parseTabFromUrl = () => {
      const targetTab = new URLSearchParams(window.location.search).get('tab');
      setActiveTab(VALID_TAB_IDS.has(targetTab) ? targetTab : 'profile');
    };

    parseTabFromUrl();
    window.addEventListener('popstate', parseTabFromUrl);
    return () => window.removeEventListener('popstate', parseTabFromUrl);
  }, [cleanCustomerId]);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    window.history.pushState({}, '', `/customer-profile/${cleanCustomerId}?tab=${tabId}`);
  };

  const ActiveComponent = TAB_COMPONENTS[activeTab];
  // Kseb also needs a projectId prop alongside customerId.
  const extraProps = activeTab === 'kseb' ? { projectId: cleanCustomerId } : {};

  return (
    <div className="customer-profile-master-pane">
      <div className="profile-header-summary-card">
        <h2>Customer Info</h2>
        <span className="meta-badge-id">Target Reference: {cleanCustomerId || 'N/A'}</span>
      </div>

      <div className="profile-tabs-navigation-bar">
        {PROFILE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`profile-nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="profile-tab-content-viewport">
        {ActiveComponent && <ActiveComponent customerId={cleanCustomerId} {...extraProps} />}
      </div>
    </div>
  );
}