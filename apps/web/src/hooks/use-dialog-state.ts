import { useState } from "react";

export function useDialogState<T = undefined>() {
  const [data, setData] = useState<{ open: boolean; data?: T }>({ open: false });
  return {
    open: data.open,
    data: data.data,
    onOpen: (d?: T) => setData({ open: true, data: d }),
    onClose: () => setData({ open: false }),
    onOpenChange: (v: boolean) => {
      if (!v) setData({ open: false });
    },
  };
}
