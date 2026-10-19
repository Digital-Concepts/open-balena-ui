import * as React from 'react';

// IP address chip linking to the device web UI (first IPv4 address).
export const renderIpAddressLink = (record: Record<string, any>): React.ReactNode => {
  const ipAddress = record['ip address'] || '';
  const ipv4Regex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
  const ipv4Addresses = ipAddress.match(ipv4Regex) || [];
  const displayIp = ipv4Addresses.join(', ');
  const hrefIp = ipv4Addresses[0];
  return displayIp && hrefIp ? (
    <a
      href={`http://${hrefIp}`}
      target='_blank'
      rel='noopener noreferrer'
      style={{
        textDecoration: 'none',
        padding: '6px 14px',
        borderRadius: '8px',
        backgroundColor: 'rgba(25, 118, 210, 0.15)',
        color: '#1976d2',
        display: 'inline-block',
        fontSize: '0.875rem',
        fontWeight: 400,
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        border: '1px solid rgba(25, 118, 210, 0.3)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(25, 118, 210, 0.25)';
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(25, 118, 210, 0.5)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(25, 118, 210, 0.15)';
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(25, 118, 210, 0.3)';
      }}
    >
      {displayIp}
    </a>
  ) : (
    ''
  );
};
