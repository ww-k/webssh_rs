import {
    SelectClear,
    SelectContent,
    SelectEmpty,
    SelectInput,
    SelectItem,
    SelectItemIndicator,
    SelectItemText,
    SelectList,
    SelectTrigger,
    SelectValue,
    Select as UiSelect,
} from "@ui-sdk/react/select";
import { Check, ChevronDown, X } from "lucide-react";

import type { CSSProperties } from "react";

import "./index.css";

export type SelectOptionValue = string | number;

export interface SelectOption<T extends SelectOptionValue = string> {
    label: string;
    value: T;
    disabled?: boolean;
}

interface SelectProps<T extends SelectOptionValue = string> {
    "aria-label"?: string;
    allowClear?: boolean;
    className?: string;
    clearLabel?: string;
    disabled?: boolean;
    emptyText?: string;
    id?: string;
    name?: string;
    onChange?: (value: T | null) => void;
    options: SelectOption<T>[];
    placeholder?: string;
    required?: boolean;
    showSearch?: boolean | { optionFilterProp?: string };
    style?: CSSProperties;
    value?: T | null;
}

export default function Select<T extends SelectOptionValue = string>({
    "aria-label": ariaLabel,
    allowClear = false,
    className,
    clearLabel = "Clear selection",
    disabled = false,
    emptyText = "No options",
    id,
    name,
    onChange,
    options,
    placeholder,
    required = false,
    showSearch = false,
    style,
    value,
}: SelectProps<T>) {
    const rootClassName = className
        ? `WebSSH-Select ${className}`
        : "WebSSH-Select";
    const searchLabel = ariaLabel ?? placeholder ?? "Search options";

    return (
        <UiSelect<T>
            items={options}
            disabled={disabled}
            name={name}
            placeholder={placeholder}
            required={required}
            value={value ?? null}
            onValueChange={(nextValue) => onChange?.(nextValue)}
        >
            <div className={rootClassName} style={style}>
                <SelectTrigger
                    disabled={disabled}
                    aria-label={ariaLabel}
                    className="WebSSH-SelectTrigger"
                    id={id}
                >
                    <SelectValue />
                    <ChevronDown aria-hidden="true" size={16} />
                </SelectTrigger>
                {allowClear && (
                    <SelectClear
                        aria-label={clearLabel}
                        className="WebSSH-SelectClear"
                    >
                        <X aria-hidden="true" size={14} />
                    </SelectClear>
                )}
            </div>
            <SelectContent
                className={`WebSSH-SelectContent${showSearch ? " is-searchable" : ""}`}
            >
                {showSearch && (
                    <SelectInput
                        aria-label={searchLabel}
                        className="WebSSH-SelectInput"
                        placeholder={placeholder}
                    />
                )}
                <SelectEmpty className="WebSSH-SelectEmpty">
                    {emptyText}
                </SelectEmpty>
                <SelectList className="WebSSH-SelectList">
                    {options.map((option) => (
                        <SelectItem
                            key={option.value}
                            label={option.label}
                            value={option.value}
                            disabled={option.disabled}
                            className="WebSSH-SelectItem"
                        >
                            <SelectItemText>{option.label}</SelectItemText>
                            <SelectItemIndicator className="WebSSH-SelectIndicator">
                                <Check aria-hidden="true" size={14} />
                            </SelectItemIndicator>
                        </SelectItem>
                    ))}
                </SelectList>
            </SelectContent>
        </UiSelect>
    );
}
