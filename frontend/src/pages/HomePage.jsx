
import { Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

import "./HomePage.css";


export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="home-page">

      {/* =========================
          NAVIGATION
      ========================= */}
      <header className="home-navbar">
        <div className="home-brand">
          <div className="home-brand-mark">
            TM
          </div>

          <div>
            <h1>
              TAXI MOVE
            </h1>

            <span>
              Smart Taxi Dispatch & Passenger Management
            </span>
          </div>
        </div>

        <nav className="home-navigation">
          <a href="#home">
            Home
          </a>

          {user ? (
            <Link
              className="home-login-button"
              to="/dashboard"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                className="home-login-link"
                to="/login"
              >
                Login
              </Link>

              <Link
                className="home-register-button"
                to="/register"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </header>


      {/* =========================
          HERO SECTION
      ========================= */}
      <main>
        <section
          className="home-hero"
          id="home"
        >
          <div className="home-hero-content">

            <span className="home-eyebrow">
              SMART PUBLIC TRANSPORT
            </span>

            <h2>
              WELCOME TO TAXI MOVE.
              YOUR JOURNEY STARTS HERE.
            </h2>

            <p>
              Connecting passengers, drivers and communities
              through smarter taxi dispatch and passenger
              management.
            </p>

            <div className="home-hero-actions">
              {user ? (
                <Link
                  className="home-primary-button"
                  to="/dashboard"
                >
                  Open Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    className="home-primary-button"
                    to="/register"
                  >
                    Get Started
                  </Link>

                  <Link
                    className="home-secondary-button"
                    to="/login"
                  >
                    Login to TAXI MOVE
                  </Link>
                </>
              )}
            </div>

            <div className="home-service-note">
              <div className="home-service-dot" />

              <div>
                <strong>
                  SIMPLE. SMART. CONNECTED.
                </strong>

                <span>
                  New passenger check-ins: 04:00 – 17:00 daily
                </span>
              </div>
            </div>

          </div>
        </section>


        {/* =========================
            CALL TO ACTION
        ========================= */}
        <section className="home-cta">
          <div>
            <span className="home-eyebrow">
              GET STARTED
            </span>

            <h2>
              Need transport?
            </h2>

            <p>
              Join TAXI MOVE to find designated waiting spots,
              request a taxi and follow your journey through
              our passenger management platform.
            </p>
          </div>

          <div className="home-cta-actions">
            {user ? (
              <Link
                className="home-primary-button"
                to="/dashboard"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  className="home-primary-button"
                  to="/register"
                >
                  Create Passenger Account
                </Link>

                <Link
                  className="home-cta-login"
                  to="/login"
                >
                  Already registered? Login
                </Link>
              </>
            )}
          </div>
        </section>
      </main>


      {/* =========================
          FOOTER
      ========================= */}
      <footer className="home-footer">
        <div>
          <strong>
            TAXI MOVE
          </strong>

          <span>
            Smart Taxi Dispatch & Passenger Management
          </span>
        </div>
      </footer>

    </div>
  );
}