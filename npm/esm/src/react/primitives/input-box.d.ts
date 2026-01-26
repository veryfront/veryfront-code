import * as React from "react";
export interface InputBoxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>, "onChange" | "onSubmit"> {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onSubmit?: () => void;
    multiline?: boolean;
}
export declare const InputBox: React.ForwardRefExoticComponent<InputBoxProps & React.RefAttributes<HTMLInputElement | HTMLTextAreaElement>>;
export interface SubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isLoading?: boolean;
    hasInput?: boolean;
    onStop?: () => void;
    onVoice?: () => void;
    icons?: {
        submit?: React.ReactNode;
        stop?: React.ReactNode;
        voice?: React.ReactNode;
    };
    children?: React.ReactNode;
}
export declare const SubmitButton: React.ForwardRefExoticComponent<SubmitButtonProps & React.RefAttributes<HTMLButtonElement>>;
export interface LoadingIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
}
export declare const LoadingIndicator: React.ForwardRefExoticComponent<LoadingIndicatorProps & React.RefAttributes<HTMLDivElement>>;
//# sourceMappingURL=input-box.d.ts.map