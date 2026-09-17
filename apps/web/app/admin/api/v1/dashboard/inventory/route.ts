import { runApiDashboard } from "../../../../../../lib/admin/dashboard-route";
export const GET = (request: Request) => runApiDashboard(request, "inventory");
