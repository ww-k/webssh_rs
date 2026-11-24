import { OverlayHost } from "@ui-sdk/react/overlays";
import { Toast, ToastTitle } from "@ui-sdk/react/toast";
import {
    CircleCheckIcon,
    InfoIcon,
    LoaderCircleIcon,
    OctagonXIcon,
    TriangleAlertIcon,
} from "lucide-react";

export default function AppOverlayHost() {
    return (
        <OverlayHost
            toast={{
                "aria-label": "Notifications",
                side: "top",
                align: "center",
                children: () => (
                    <Toast>
                        <CircleCheckIcon
                            data-show="success"
                            aria-hidden="true"
                        />
                        <InfoIcon data-show="info" aria-hidden="true" />
                        <TriangleAlertIcon
                            data-show="warning"
                            aria-hidden="true"
                        />
                        <OctagonXIcon data-show="error" aria-hidden="true" />
                        <LoaderCircleIcon
                            data-show="loading"
                            aria-hidden="true"
                        />
                        <ToastTitle />
                    </Toast>
                ),
            }}
        />
    );
}
