export class InventoryError extends Error { constructor(message:string,readonly code:string,readonly status:number){super(message);this.name=new.target.name;} }
export class InsufficientInventoryError extends InventoryError { constructor(){super("Requested inventory is unavailable","insufficient_inventory",409);} }
export class InvalidInventoryQuantityError extends InventoryError { constructor(){super("Inventory quantity must be a positive integer","invalid_inventory_quantity",400);} }
