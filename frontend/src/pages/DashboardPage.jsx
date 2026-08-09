import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


const dashboardContent = {
  PASSENGER: {
    title: "Passenger Dashboard",
    description:
      "View waiting spots and manage your transport request.",
    cards: [
      "Nearby waiting spots",
      "Current waiting request",
      "Dispatch notifications",
    ],
  },

  DRIVER: {
    title: "Driver Dashboard",
    description:
      "View dispatch assignments and update your trip status.",
    cards: [
      "Active dispatch",
      "Dispatch history",
      "Driver availability",
    ],
  },

  DISPATCHER: {
    title: "Dispatcher Dashboard",
    description:
      "Monitor passenger demand and coordinate taxi dispatches.",
    cards: [
      "Waiting spot demand",
      "Available drivers",
      "Dispatch activity",
    ],
  },
};


export default function DashboardPage() {
  const { user } = useAuth();

  const content = dashboardContent[user.role];

  return (
    <AppLayout>
      <section className="page-heading">
        <h2>{content?.title ?? "TaxiLink Dashboard"}</h2>
        <p>{content?.description}</p>
      </section>

      <section className="dashboard-grid">
        {content?.cards.map((card) => (
          <article className="dashboard-card" key={card}>
            <h3>{card}</h3>
            <p>This feature will be added in the next increment.</p>
          </article>
        ))}
      </section>
    </AppLayout>
  );
}