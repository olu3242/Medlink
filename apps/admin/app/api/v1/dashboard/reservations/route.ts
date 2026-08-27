import { runApiDashboard } from "../../../../../lib/dashboard-route";
export const GET = (request: Request) => runApiDashboard(request, "reservations");
