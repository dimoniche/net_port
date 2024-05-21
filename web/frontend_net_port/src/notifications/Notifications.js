import React from "react";
import NotificationsSystem, { atalhoTheme, useNotifications } from "reapop";

const Notifcations = () => {
  const { notifications, dismissNotification } = useNotifications();

  if (notifications.length > 1) {
    notifications.shift();
  }

  return (
    <div>
      <NotificationsSystem
        notifications={notifications}
        dismissNotification={(id) => dismissNotification(id)}
        theme={atalhoTheme}
      />
    </div>
  );
};

export default Notifcations;
