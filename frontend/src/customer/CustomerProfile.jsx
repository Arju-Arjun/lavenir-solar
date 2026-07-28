import React, { useState, useEffect } from 'react';
import Profile from './C_Profile';
import SiteVisit from './SiteVisit';
import MNREProfile from './MNREProfile';
import PaymentFlow from './PaymentFlow';
import BankLoanView from './BankLoanView';
import Kseb from './Kseb';
import KsebRegistration from "./KsebRegistration";
import MNREInstallation from './MNREInstallation';
import DCR from './DCR';
import Services from './Services';
import  MaterialDelivery from './MaterialDelivery';
import MaterialInstallation from './MaterialInstallation';


export default function CustomerProfile() {
  const [customerId, setCustomerId] = useState('');
  const [activeTab, setActiveTab] = useState('profile');

  // Links matching workflow nodes
  const profileTabs = [
    { id: 'profile', label: 'PROFILE' },
    { id: 'site-visit', label: 'SITE VISIT' },
    { id: 'mnre-profile', label: 'MNRE PROFILE' },
    { id: 'payment-flow', label: 'PAYMENT FLOW' },
    { id: 'bank-loan', label: 'BANK LOAN' },
    { id: 'kseb', label: 'KSEB FEASIBILITY ' },
    { id: 'material-delivery', label: 'MATERIAL DELIVERY' },
    { id: 'installation', label: 'INSTALLATION' },
    { id: 'completion', label: 'KSEB REGISTRATION & COMPLETION' },
    { id: 'dcr', label: 'DCR' },
    { id: 'mnre-installation', label: 'MNRE INSTALLATION' },
    { id: 'service', label: 'SERVICE & MAINTENANCE' }
  ];

  // Custom native URL listener
  useEffect(() => {
    const parseUrlState = () => {
      const segments = window.location.pathname.split('/');
      const id = segments[segments.length - 1];
      setCustomerId(id);

      const urlParams = new URLSearchParams(window.location.search);
      const targetTab = urlParams.get('tab');
      if (targetTab) {
        setActiveTab(targetTab);
      } else {
        setActiveTab('profile');
      }
    };

    parseUrlState();
    window.addEventListener('popstate', parseUrlState);
    return () => window.removeEventListener('popstate', parseUrlState);
  }, []);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    const newPath = `/customer-profile/${customerId}?tab=${tabId}`;
    window.history.pushState({}, '', newPath);
  };

  return (
    <div className="customer-profile-master-pane">
      {/* PERSISTENT HEADER BLOCK */}
      <div className="profile-header-summary-card">
        <h2>Customer Info</h2>
        <span className="meta-badge-id">Target Reference: {customerId || 'N/A'}</span>
      </div>

      {/* HORIZONTAL WORKFLOW CONTROL TRACK BAR */}
      <div className="profile-tabs-navigation-bar">
        {profileTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`profile-nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* RENDER VIEWPORTS FRAME */}
      <div className="profile-tab-content-viewport">
        {activeTab === 'profile' && (
          <Profile customerId={customerId} />
        )}

        {/* site-visit */}

        {activeTab === 'site-visit' && (
          <SiteVisit customerId={customerId} />
        )}

        {/* mnre-profile */}

        {activeTab === 'mnre-profile' && (
          <MNREProfile customerId={customerId} />
        )}

        {/* payment-flow */}
        {activeTab === 'payment-flow' && (
          <PaymentFlow customerId={customerId} />
        )}
        {/* bank-loan */} 

        {activeTab === 'bank-loan' && (
          <BankLoanView customerId={customerId} />
        )}

        {activeTab === 'kseb' && (
          <Kseb customerId={customerId} projectId={customerId} />
        )}

        {activeTab === 'completion' && (
          <KsebRegistration customerId={customerId} />
        )}

        {activeTab === 'mnre-installation' && (
          <MNREInstallation customerId={customerId} />
        )}


        {activeTab === 'dcr' && (
          <DCR customerId={customerId} />
        )}

        {activeTab === 'service' && (
          <Services customerId={customerId} />
        )}


        {activeTab === 'material-delivery' && (
          <MaterialDelivery customerId={customerId} />
        )}

        {activeTab === 'installation' && (
          <MaterialInstallation customerId={customerId} />
        )}

      </div>
    </div>
  );
}