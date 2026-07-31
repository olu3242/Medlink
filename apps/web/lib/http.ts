import { NextResponse } from "next/server";
import { PlatformError } from "@medlink/platform";

export function problemResponse(error: unknown) {
  if (error instanceof PlatformError) {
    return NextResponse.json(
      {
        type: `https://medlink.health/problems/${error.code}`,
        title: error.name,
        status: error.status,
        detail: error.message,
      },
      {
        status: error.status,
        headers: { "content-type": "application/problem+json" },
      },
    );
  }

  return NextResponse.json(
    {
      type: "https://medlink.health/problems/internal_error",
      title: "Internal Server Error",
      status: 500,
    },
    { status: 500, headers: { "content-type": "application/problem+json" } },
  );
}
