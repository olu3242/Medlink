export class ReservationError extends Error{constructor(message:string,readonly code:string,readonly status:number){super(message);this.name=new.target.name;}}
export class ReservationNotFoundError extends ReservationError{constructor(){super("Reservation was not found","reservation_not_found",404);}}
export class InvalidReservationError extends ReservationError{constructor(){super("Reservation quantity and expiry are invalid","invalid_reservation",400);}}
