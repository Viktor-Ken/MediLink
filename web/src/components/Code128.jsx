import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function Code128({ value, height = 46, width = 2 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          height,
          width,
          displayValue: false,
          margin: 2,
        });
      } catch {
        /* value not encodable — skip */
      }
    }
  }, [value, height, width]);

  return <svg ref={ref} role="img" aria-label={`barcode ${value}`} />;
}