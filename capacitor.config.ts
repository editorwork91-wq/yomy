/// <reference types="@capacitor-firebase/authentication" />
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yomy.app',
  appName: 'Yomy',
  webDir: 'dist',
  plugins: {
    FirebaseAuthentication: {
      // YOMY uses native Firebase only for phone verification. Google sign-in is disabled.
      providers: ['phone'],
      skipNativeAuth: false,
    },
  },
};

export default config;
