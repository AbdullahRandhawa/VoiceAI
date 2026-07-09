import { syncUser } from './api';

export const upsertUserDocument = async (user) => {
  if (!user) return;
  
  const userData = {
    display_name: user.displayName || null,
    photo_url: user.photoURL || null,
    provider: user.providerData?.[0]?.providerId || 'email',
  };

  try {
    // We delegate to the backend to bypass restrictive Firestore client security rules
    await syncUser(userData);
  } catch (error) {
    console.error('Error syncing user document to backend:', error);
  }
};
