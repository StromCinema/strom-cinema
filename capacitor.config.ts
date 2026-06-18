import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.strom.cinema',
  appName: 'Strom Cinema',
  webDir: 'dist',
  android: {
    allowMixedContent: true,   // needed for HTTP streams from your companion server
    backgroundColor: '#000000',
  },
  server: {
    // Allow cleartext HTTP to your companion server on the local network
    cleartext: true,
  },
};

export default config;