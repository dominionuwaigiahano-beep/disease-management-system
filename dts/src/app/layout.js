import './globals.css';

/* Typography is set from families already present on the device. A
   hospital workstation on a slow or intermittent connection should not
   have to fetch a font file before the page is readable, and no request
   leaves the network to render the interface. */

export const metadata = {
  title: 'Disease Trend Analysis and Reporting System',
  description:
    'Monthly disease trend analysis and outbreak signalling for the University of Benin Teaching Hospital.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
