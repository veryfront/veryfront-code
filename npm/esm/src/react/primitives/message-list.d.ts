import * as React from "react";
import type { UIMessage } from "../../agent/react/index.js";
export interface MessageListProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}
export declare const MessageList: React.ForwardRefExoticComponent<MessageListProps & React.RefAttributes<HTMLDivElement>>;
export interface MessageItemProps extends React.HTMLAttributes<HTMLDivElement> {
    role: UIMessage["role"];
    /** Message content (can be children or prop) - deprecated, use children with parts */
    content?: string;
    children?: React.ReactNode;
}
export declare const MessageItem: React.ForwardRefExoticComponent<MessageItemProps & React.RefAttributes<HTMLDivElement>>;
export interface MessageRoleProps extends React.HTMLAttributes<HTMLSpanElement> {
    children: React.ReactNode;
}
export declare const MessageRole: React.ForwardRefExoticComponent<MessageRoleProps & React.RefAttributes<HTMLSpanElement>>;
export interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}
export declare const MessageContent: React.ForwardRefExoticComponent<MessageContentProps & React.RefAttributes<HTMLDivElement>>;
//# sourceMappingURL=message-list.d.ts.map