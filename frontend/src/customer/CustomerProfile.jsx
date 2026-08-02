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
  }, [customerId]);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    window.history.pushState({}, '', `/customer-profile/${customerId}?tab=${tabId}`);
  };

  const ActiveComponent = TAB_COMPONENTS[activeTab];
  // Kseb also needs a projectId prop alongside customerId.
  const extraProps = activeTab === 'kseb' ? { projectId: customerId } : {};

  return (
    <div className="customer-profile-master-pane">
      <div className="profile-header-summary-card">
        <h2>Customer Info</h2>
        <span className="meta-badge-id">Target Reference: {customerId || 'N/A'}</span>
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
        {ActiveComponent && <ActiveComponent customerId={customerId} {...extraProps} />}
      </div>
    </div>
  );
}