import { InputClear, InputGroup, Input as UiInput } from "@ui-sdk/react/input";
import {
    PasswordInput,
    PasswordInputControl,
    PasswordInputToggle,
} from "@ui-sdk/react/password-input";
import { Textarea as UiTextarea } from "@ui-sdk/react/textarea";
import { Eye, EyeOff, X } from "lucide-react";
import {
    type ChangeEvent,
    type ComponentProps,
    forwardRef,
    type KeyboardEvent,
    type ReactNode,
} from "react";

import "./index.css";

type NativeInputProps = Omit<
    ComponentProps<typeof UiInput>,
    "className" | "onKeyDown" | "prefix" | "size" | "suffix"
> & {
    allowClear?: boolean;
    className?: string;
    prefix?: ReactNode;
    size?: "small" | "middle" | "large";
    suffix?: ReactNode;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onPressEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

function joinClasses(...classes: Array<string | undefined | false>) {
    return classes.filter(Boolean).join(" ");
}

const InputBase = forwardRef<HTMLInputElement, NativeInputProps>(
    function InputBase(
        {
            allowClear = false,
            className,
            onKeyDown,
            onPressEnter,
            prefix,
            size = "middle",
            suffix,
            ...props
        },
        ref,
    ) {
        const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
            onKeyDown?.(event);
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                onPressEnter?.(event);
            }
        };
        const input = (
            <UiInput
                {...props}
                ref={ref}
                className={joinClasses(
                    "webssh-input",
                    `webssh-input-${size}`,
                    className,
                )}
                onKeyDown={handleKeyDown}
            />
        );

        if (!prefix && !suffix && !allowClear) return input;

        return (
            <InputGroup
                className={joinClasses(
                    "webssh-input-group",
                    `webssh-input-${size}`,
                    className,
                )}
            >
                {prefix && (
                    <span className="webssh-input-prefix">{prefix}</span>
                )}
                {input}
                {suffix && (
                    <span className="webssh-input-suffix">{suffix}</span>
                )}
                {allowClear && (
                    <InputClear
                        aria-label="Clear input"
                        className="webssh-input-clear"
                    >
                        <X aria-hidden="true" size={14} />
                    </InputClear>
                )}
            </InputGroup>
        );
    },
);

type PasswordProps = Omit<
    ComponentProps<typeof PasswordInput>,
    "children" | "className" | "onChange" | "onKeyDown" | "value"
> & {
    autoFocus?: boolean;
    className?: string;
    id?: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onPressEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
    placeholder?: string;
    value?: string | number;
};

const Password = forwardRef<HTMLInputElement, PasswordProps>(function Password(
    {
        autoFocus,
        className,
        defaultValue,
        id,
        onChange,
        onKeyDown,
        onPressEnter,
        placeholder,
        value,
        ...props
    },
    ref,
) {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            onPressEnter?.(event);
        }
    };

    return (
        <PasswordInput
            {...props}
            className={joinClasses("webssh-password-input", className)}
            defaultValue={defaultValue}
            value={value == null ? undefined : String(value)}
        >
            <PasswordInputControl
                ref={ref}
                className="webssh-password-input-control"
                autoFocus={autoFocus}
                id={id}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
            />
            <PasswordInputToggle
                aria-label="Show password"
                className="webssh-password-input-toggle"
            >
                {(state) =>
                    state.visible ? (
                        <EyeOff aria-hidden="true" size={16} />
                    ) : (
                        <Eye aria-hidden="true" size={16} />
                    )
                }
            </PasswordInputToggle>
        </PasswordInput>
    );
});

const TextArea = forwardRef<
    HTMLTextAreaElement,
    ComponentProps<typeof UiTextarea>
>(function TextArea({ className, ...props }, ref) {
    return (
        <UiTextarea
            {...props}
            ref={ref}
            className={joinClasses(
                "webssh-input webssh-textarea",
                typeof className === "string" ? className : undefined,
            )}
        />
    );
});

const Input = Object.assign(InputBase, { Password, TextArea });

export default Input;
