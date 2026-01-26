/****
 * Empty State Components
 * @module ai/react/components/chat/components/empty-state
 */
import * as React from "react";
export interface SuggestionProps {
    suggestion: string;
    onClick?: (suggestion: string) => void;
    className?: string;
    icon?: React.ReactNode;
}
export declare function Suggestion({ suggestion, onClick, className, icon, }: SuggestionProps): React.ReactElement;
export interface SuggestionsProps {
    children: React.ReactNode;
    className?: string;
    layout?: "grid" | "horizontal";
}
export declare function Suggestions({ children, className, layout, }: SuggestionsProps): React.ReactElement;
export interface ConversationEmptyStateProps {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
    children?: React.ReactNode;
    className?: string;
}
export declare function ConversationEmptyState({ icon, title, description, children, className, }: ConversationEmptyStateProps): React.ReactElement;
export interface ConversationScrollButtonProps {
    onClick?: () => void;
    visible?: boolean;
    className?: string;
}
export declare function ConversationScrollButton({ onClick, visible, className, }: ConversationScrollButtonProps): React.ReactElement | null;
//# sourceMappingURL=empty-state.d.ts.map