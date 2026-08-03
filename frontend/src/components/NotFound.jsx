import React from 'react';
import { useAuth } from '../context/AuthContext';

function NotFound() {
  const { role } = useAuth();

  const goToDashboard = () => {
    window.location.href = '/';
  };

  const goToProjects = () => {
    window.location.href = '/customers';
  };

  const goToLogin = () => {
    window.location.href = '/';
  };

  return (
    <div className="notfound-wrapper">
      <div className="notfound-image-col">
        <img
          src="assets/404-solar.png"
          alt="Cracked solar panel showing a 404 error"
          className="notfound-image"
        />
      </div>

      <div className="notfound-content-col">
        <h1 className="notfound-heading">
          LAVENIR SOLAR<br />PAGE NOT FOUND
        </h1>

        <p className="notfound-text">
          Oops! The page you are looking for is experiencing an unexpected outage.
        </p>
        <p className="notfound-text">
          This project location or data seems to have gone offline or is currently
          unavailable. Let's get you back on the grid.
        </p>

        <div className="notfound-actions">
          {role ? (
            <>
              <button className="notfound-btn-primary" onClick={goToDashboard}>
                Return to Dashboard
              </button>
              <button className="notfound-btn-outline" onClick={goToProjects}>
                Browse All Projects
              </button>
            </>
          ) : (
            <button className="notfound-btn-primary" onClick={goToLogin}>
              Go to Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotFound;