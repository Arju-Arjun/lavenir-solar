import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToPush } from '../utils/push';

function NotificationBell() {
  const { role } = useAuth();
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (role && token && !subscribed) {
      subscribeToPush(token)
        .then((sub) => {
          if (sub) {
            setSubscribed(true);
            console.log('Push notifications subscribed successfully');
          }
        })
        .catch((err) => console.error('Push subscribe failed:', err));
    }
  }, [role]);

  return (
    <button className="notification-bell-btn" onClick={() => {/* open dropdown later */}}>
      🔔
    </button>
  );
}

export default NotificationBell;