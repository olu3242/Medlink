export * from "./service";
export class NotificationError extends Error{constructor(message:string,readonly code:string){super(message);this.name=new.target.name;}}
