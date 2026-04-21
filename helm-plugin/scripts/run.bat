@echo off
setlocal EnableDelayedExpansion

:: =============================================================================
:: helm viz — Helm CLI plugin (Windows)
:: Launches the Helm Chart Visualizer web UI for a given chart directory.
:: =============================================================================

set "SCRIPT_DIR=%~dp0"
set "PLUGIN_DIR=%SCRIPT_DIR%.."
set "PORT=3000"
set "APP_URL="
set "CHART_DIR="
set "EXTRA_VALUES="
set "NO_OPEN=false"
set "APP_DIR="

if defined HELM_VIZ_PORT set "PORT=%HELM_VIZ_PORT%"

:: ---------------------------------------------------------------------------
:: Argument parsing
:: ---------------------------------------------------------------------------
:parse_args
if "%~1"=="" goto :end_parse
if /i "%~1"=="-h"       goto :show_help
if /i "%~1"=="--help"   goto :show_help
if /i "%~1"=="-p" (
    if "%~2"=="" (
        echo Error: Flag %~1 requires a value. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    echo %~2 | findstr /r "^-" >nul 2>&1
    if !errorlevel!==0 (
        echo Error: Flag %~1 requires a value; got another flag '%~2'. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    set "PORT=%~2"
    shift & shift & goto :parse_args
)
if /i "%~1"=="--port" (
    if "%~2"=="" (
        echo Error: Flag %~1 requires a value. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    echo %~2 | findstr /r "^-" >nul 2>&1
    if !errorlevel!==0 (
        echo Error: Flag %~1 requires a value; got another flag '%~2'. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    set "PORT=%~2"
    shift & shift & goto :parse_args
)
if /i "%~1"=="-f" (
    if "%~2"=="" (
        echo Error: Flag %~1 requires a value. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    echo %~2 | findstr /r "^-" >nul 2>&1
    if !errorlevel!==0 (
        echo Error: Flag %~1 requires a value; got another flag '%~2'. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    set "EXTRA_VALUES=%~2"
    shift & shift & goto :parse_args
)
if /i "%~1"=="--values" (
    if "%~2"=="" (
        echo Error: Flag %~1 requires a value. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    echo %~2 | findstr /r "^-" >nul 2>&1
    if !errorlevel!==0 (
        echo Error: Flag %~1 requires a value; got another flag '%~2'. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    set "EXTRA_VALUES=%~2"
    shift & shift & goto :parse_args
)
if /i "%~1"=="--url" (
    if "%~2"=="" (
        echo Error: Flag %~1 requires a value. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    echo %~2 | findstr /r "^-" >nul 2>&1
    if !errorlevel!==0 (
        echo Error: Flag %~1 requires a value; got another flag '%~2'. 1>&2
        echo Run 'helm viz --help' for usage. 1>&2
        exit /b 1
    )
    set "APP_URL=%~2"
    shift & shift & goto :parse_args
)
if /i "%~1"=="--no-open" ( set "NO_OPEN=true"  & shift & goto :parse_args )
:: Treat unknown flags as errors
echo %~1 | findstr /r "^-" >nul 2>&1
if !errorlevel!==0 (
    echo Error: Unknown flag: %~1 1>&2
    echo Run 'helm viz --help' for usage. 1>&2
    exit /b 1
)
:: Positional argument = chart directory
if "!CHART_DIR!"=="" (
    set "CHART_DIR=%~1"
) else (
    echo Error: unexpected argument '%~1' ^(chart directory already set^) 1>&2
    exit /b 1
)
shift
goto :parse_args
:end_parse

:: ---------------------------------------------------------------------------
:: Resolve chart directory
:: ---------------------------------------------------------------------------
if "!CHART_DIR!"=="" set "CHART_DIR=%CD%"

if not exist "!CHART_DIR!\" (
    echo Error: chart directory not found: !CHART_DIR! 1>&2
    exit /b 1
)

if not exist "!CHART_DIR!\Chart.yaml" (
    echo Error: '!CHART_DIR!' does not appear to be a Helm chart ^(missing Chart.yaml^). 1>&2
    exit /b 1
)

if not "!EXTRA_VALUES!"=="" (
    if not exist "!EXTRA_VALUES!" (
        echo Error: values file not found: !EXTRA_VALUES! 1>&2
        exit /b 1
    )
)

:: ---------------------------------------------------------------------------
:: Main
:: ---------------------------------------------------------------------------
echo =^>^> Helm Chart Visualizer
echo     Chart : !CHART_DIR!
if not "!EXTRA_VALUES!"=="" echo     Values: !EXTRA_VALUES!

:: If --url was supplied, just open the browser
if not "!APP_URL!"=="" (
    echo =^>^> Connecting to !APP_URL!
    if "!NO_OPEN!"=="false" start "" "!APP_URL!"
    exit /b 0
)

set "TARGET_URL=http://localhost:!PORT!"

:: Check if a server is already running
curl -sf "!TARGET_URL!/api/workspace-chart" --max-time 2 >nul 2>&1
if !errorlevel!==0 (
    echo =^>^> Visualizer already running at !TARGET_URL!
    if "!NO_OPEN!"=="false" start "" "!TARGET_URL!"
    exit /b 0
)

:: ---------------------------------------------------------------------------
:: Find the Helm Visualizer app
:: ---------------------------------------------------------------------------
call :find_app
if "!APP_DIR!"=="" (
    echo. 1>&2
    echo Error: Could not find the Helm Visualizer application. 1>&2
    echo. 1>&2
    echo To fix this, either: 1>&2
    echo. 1>&2
    echo   A^) Install the plugin from within the cloned repository: 1>&2
    echo. 1>&2
    echo        git clone https://github.com/unrealandychan/Helm-Visualizer 1>&2
    echo        cd Helm-Visualizer 1>&2
    echo        npm install 1>&2
    echo        helm plugin install .\helm-plugin 1>&2
    echo. 1>&2
    echo   B^) Set HELM_VISUALIZER_DIR to the app's root directory: 1>&2
    echo. 1>&2
    echo        set HELM_VISUALIZER_DIR=C:\path\to\Helm-Visualizer 1>&2
    echo        helm viz .\my-chart 1>&2
    echo. 1>&2
    echo   C^) If the Visualizer server is already running, use --url: 1>&2
    echo. 1>&2
    echo        helm viz --url http://localhost:3000 .\my-chart 1>&2
    echo. 1>&2
    exit /b 1
)

echo =^>^> Found Helm Visualizer at: !APP_DIR!
echo =^>^> Starting server on port !PORT!...

cd /d "!APP_DIR!"

:: Install dependencies if missing
if not exist "node_modules\" (
    echo =^>^> Installing Node.js dependencies ^(this may take a minute on first run^)...
    npm install
)

:: Export environment variables for the Next.js server
set "HELM_CHART_DIR=!CHART_DIR!"
if not "!EXTRA_VALUES!"=="" (
    echo Warning: --values is currently ignored because the Helm Visualizer server does not support HELM_VIZ_EXTRA_VALUES. 1>&2
)
set "PORT=!PORT!"

:: Start the dev server in a new window so Ctrl+C in this window kills it cleanly
start "Helm Visualizer" cmd /c npm run dev

:: Wait up to 30 seconds for the server to be ready
echo =^>^> Waiting for server...
set /a attempts=0
:wait_loop
curl -sf "!TARGET_URL!/api/workspace-chart" --max-time 2 >nul 2>&1
if !errorlevel!==0 goto :server_ready
set /a attempts+=1
if !attempts! geq 30 (
    echo Error: Timed out waiting for the server to start. 1>&2
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto :wait_loop

:server_ready
echo =^>^> Server is ready!
if "!NO_OPEN!"=="false" start "" "!TARGET_URL!"

echo.
echo =^>^> Helm Visualizer is running at !TARGET_URL!
echo     Chart : !CHART_DIR!
if not "!EXTRA_VALUES!"=="" echo     Values: !EXTRA_VALUES!
echo.
echo     The server is running in the "Helm Visualizer" window.
echo     Close that window or press Ctrl+C there to stop it.
echo.
exit /b 0

:: ---------------------------------------------------------------------------
:find_app
:: 1. Explicit environment variable
if not "!HELM_VISUALIZER_DIR!"=="" (
    if exist "!HELM_VISUALIZER_DIR!\package.json" (
        findstr /c:"helm-chart-visualizer" "!HELM_VISUALIZER_DIR!\package.json" >nul 2>&1
        if !errorlevel!==0 (
            set "APP_DIR=!HELM_VISUALIZER_DIR!"
            exit /b 0
        )
    )
)

:: 2. Plugin installed from within the cloned repository (plugin dir is helm-plugin\)
set "CANDIDATE=%PLUGIN_DIR%\.."
if exist "!CANDIDATE!\package.json" (
    findstr /c:"helm-chart-visualizer" "!CANDIDATE!\package.json" >nul 2>&1
    if !errorlevel!==0 (
        pushd "!CANDIDATE!" && set "APP_DIR=!CD!" && popd
        exit /b 0
    )
)

:: 3. Common install locations
for %%D in (
    "%USERPROFILE%\Helm-Visualizer"
    "%USERPROFILE%\helm-visualizer"
    "C:\helm-visualizer"
) do (
    if exist "%%~D\package.json" (
        findstr /c:"helm-chart-visualizer" "%%~D\package.json" >nul 2>&1
        if !errorlevel!==0 (
            set "APP_DIR=%%~D"
            exit /b 0
        )
    )
)

exit /b 0

:: ---------------------------------------------------------------------------
:show_help
echo Launch the Helm Chart Visualizer web UI for a given chart directory.
echo.
echo Usage:
echo   helm viz [CHART_DIR] [flags]
echo.
echo Arguments:
echo   CHART_DIR   Path to the Helm chart directory (default: current directory)
echo.
echo Flags:
echo   -f, --values FILE   Additional values YAML file to merge
echo   -p, --port  PORT    Port for the local web server (default: 3000)
echo       --url   URL     Connect to an already-running Visualizer
echo       --no-open       Do not open the browser automatically
echo   -h, --help          Show this help message
echo.
echo Environment variables:
echo   HELM_VISUALIZER_DIR   Absolute path to the Helm Visualizer app directory
echo   HELM_VIZ_PORT         Port override (default: 3000)
echo.
echo Examples:
echo   helm viz .\my-chart
echo   helm viz .\my-chart -f .\my-chart\values.prod.yaml
echo   helm viz --port 8080 .\my-chart
echo   helm viz --url http://localhost:3000 .\my-chart
exit /b 0
