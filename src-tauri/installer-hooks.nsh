!macro NSIS_HOOK_POSTINSTALL
  ; Ask Explorer to refresh shortcut and taskbar icon caches after an upgrade.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
