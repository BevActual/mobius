; Mobius's additions to the Windows installer (Tauri's NSIS template calls these macros).
;
; Before copying: Mobius and its helpers (the core, the inert MCP server, the page engine's helper processes, which run
; as more copies of the main program) must have exited, or their files cannot be replaced. A copy already on its way
; out (Restart to Update quits Mobius, then starts this) gets three seconds to finish. Mobius stays running in the tray
; with its window closed, so a copy that is simply open would never go by itself: it is then stopped, and the install
; stops if it still will not go after ten more seconds.
;
; After copying: the installed program must be the version this installer carries. A file that could not be replaced
; leaves the old one behind; that is reported as a failed install (exit code 2), never as a success.
;
; Running programs are found with Tauri's own NSIS plugin (nsis_tauri_utils, which its template already loads), which
; answers at once. Asking tasklist could take a second or more each time, for up to forty times, and an open copy was
; given ten seconds to close by itself first: a silent install over a running Mobius took 89 s (19 November 2026).

!macro MOBIUS_FIND NAME RESULT
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${NAME}"
  !else
    nsis_tauri_utils::FindProcess "${NAME}"
  !endif
  Pop ${RESULT}
!macroend

!macro MOBIUS_RUNNING RESULT
  ; 0 when one of Mobius's programs is still running.
  ; Labels, not relative jumps: a plugin call is more than one instruction. Inserted once, in NSIS_HOOK_PREINSTALL.
  !insertmacro MOBIUS_FIND "${MAINBINARYNAME}.exe" ${RESULT}
  StrCmp ${RESULT} 0 mobius_found
  !insertmacro MOBIUS_FIND "mobius-cored.exe" ${RESULT}
  StrCmp ${RESULT} 0 mobius_found
  !insertmacro MOBIUS_FIND "mobius-inert-mcp.exe" ${RESULT}
  mobius_found:
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCpy $R7 0
  mobius_wait_close:
    !insertmacro MOBIUS_RUNNING $R8
    StrCmp $R8 0 0 mobius_closed
    IntOp $R7 $R7 + 1
    ; Three seconds to close by themselves, then they are stopped.
    IntCmp $R7 6 0 mobius_wait_more 0
      nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
      Pop $R9
      nsExec::Exec 'taskkill /F /T /IM "mobius-cored.exe"'
      Pop $R9
      nsExec::Exec 'taskkill /F /T /IM "mobius-inert-mcp.exe"'
      Pop $R9
    IntCmp $R7 26 mobius_still_running 0 mobius_still_running
    mobius_wait_more:
    Sleep 500
    Goto mobius_wait_close
  mobius_still_running:
    SetErrorLevel 2
    MessageBox MB_ICONSTOP|MB_OK "Mobius is still running, so it could not be updated. Quit Mobius and run the installer again." /SD IDOK
    Abort "Mobius is still running."
  mobius_closed:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  GetDLLVersion "$INSTDIR\${MAINBINARYNAME}.exe" $R0 $R1
  ; No version to read (a build without one): nothing to compare.
  IfErrors mobius_copied
  IntOp $R2 $R0 >> 16
  IntOp $R2 $R2 & 0xFFFF
  IntOp $R3 $R0 & 0xFFFF
  IntOp $R4 $R1 >> 16
  IntOp $R4 $R4 & 0xFFFF
  StrCpy $R5 "$R2.$R3.$R4"
  ; The version may carry a pre-release part (0.2.0-beta.1); the program's own version is the numbers before it.
  StrLen $R6 $R5
  StrCpy $R7 "${VERSION}" $R6
  StrCpy $R8 "${VERSION}" 1 $R6
  StrCmp $R7 $R5 0 mobius_copy_failed
  StrCmp $R8 "" mobius_copied
  StrCmp $R8 "-" mobius_copied
  mobius_copy_failed:
    SetErrorLevel 2
    MessageBox MB_ICONSTOP|MB_OK "Mobius could not replace its files ($R5 is still installed, not ${VERSION}). Quit Mobius and run the installer again." /SD IDOK
    Abort "Mobius's files could not be replaced."
  mobius_copied:
!macroend
