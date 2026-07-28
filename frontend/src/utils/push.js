const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`; // change to your deployed backend URL in production

// Convert VAPID public key (base64) to Uint8Array — required by pushManager.subscribe
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPush(token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported in this browser');
    return null;
  }

  // 1. Ask permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission denied');
    return null;
  }

  // 2. Get service worker registration
  const registration = await navigator.serviceWorker.ready;

  // 3. Get VAPID public key from backend
  const keyRes = await fetch(`${API_BASE}/push/vapid-public-key`);
  const { publicKey } = await keyRes.json();

  // 4. Subscribe (or reuse existing subscription)
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  // 5. Send subscription to backend
  await fetch(`${API_BASE}/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(subscription)
  });

  return subscription;
}