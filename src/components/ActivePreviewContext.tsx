import React, { createContext, useContext, useState, useEffect } from 'react';

interface ActivePreviewContextType {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  activeVolume: number; // centralized volume level to coordinate crossfading
}

const ActivePreviewContext = createContext<ActivePreviewContextType>({
  activeId: null,
  setActiveId: () => {},
  activeVolume: 1.0,
});

export const useActivePreview = () => useContext(ActivePreviewContext);

export const ActivePreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <ActivePreviewContext.Provider value={{ activeId, setActiveId, activeVolume: 0.6 }}>
      {children}
    </ActivePreviewContext.Provider>
  );
};
