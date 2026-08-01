# Maps and Location

RC1 stores pharmacy coordinates and LGA, calculates great-circle distance locally, filters by tenant and radius, and returns nearest results deterministically. Set `MAPS_PROVIDER=internal` for this mode. Google or Mapbox may be selected with `MAPS_API_KEY` for basic geocoding only. Advanced routing, dispatch, and courier logistics are RC2 concerns.
