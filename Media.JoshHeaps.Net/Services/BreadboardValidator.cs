using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Media.JoshHeaps.Net.Services;

/// <summary>
/// Outcome of validating a breadboard circuit document. Errors are terse
/// machine-readable "path:reason" tokens that are safe to return to the client:
/// they never echo unbounded user input, file paths, or exception detail.
/// </summary>
public sealed record BreadboardValidationResult(bool IsValid, IReadOnlyList<string> Errors)
{
    public static BreadboardValidationResult Ok() => new(true, Array.Empty<string>());

    public static BreadboardValidationResult Fail(IReadOnlyList<string> errors) => new(false, errors);
}

/// <summary>
/// Server-side structural validation of the circuit JSONB document (schema v1)
/// before persistence. Never throws for expected-invalid input — malformed JSON,
/// wrong types, missing fields and out-of-range values all come back as errors.
/// Stateless and thread-safe.
/// </summary>
public class BreadboardValidator(ILogger<BreadboardValidator> logger)
{
    /// <summary>Only schema version 1 exists in milestone 1.</summary>
    public const int SupportedVersion = 1;

    /// <summary>Hard cap on the raw UTF-8 size of the circuit document (2 MB, per the team contract).</summary>
    public const int MaxCircuitBytes = 2 * 1024 * 1024;

    /// <summary>A realistic desk holds a handful of boards; 50 is generous and bounds net extraction cost.</summary>
    public const int MaxBoards = 50;

    /// <summary>Team amendment A11: pinned to the JS shared/ constants. Higher counts could exceed the 2 MB byte cap.</summary>
    public const int MaxComponents = 3000;

    /// <summary>Team amendment A11: pinned to the JS shared/ constants, and bounds union-find work in the engine.</summary>
    public const int MaxWires = 10000;

    /// <summary>Per the schema contract: any string up to 40 chars.</summary>
    public const int MaxUidLength = 40;

    /// <summary>The deepest legal path in schema v1 is 6 (circuit > components > component > props > to > value), so 8 is ample.</summary>
    public const int MaxJsonDepth = 8;

    /// <summary>No schema string is meaningfully longer than this; keeps a multi-megabyte "color" from being compared or echoed.</summary>
    public const int MaxStringLength = 64;

    /// <summary>Cap on returned errors so a hostile document cannot produce a huge response.</summary>
    public const int MaxErrors = 50;

    /// <summary>Full-size 830-point board: 63 columns in the main grid.</summary>
    public const int MainColumnMin = 1;
    public const int MainColumnMax = 63;

    /// <summary>Each power rail exposes 50 tie points.</summary>
    public const int RailIndexMin = 1;
    public const int RailIndexMax = 50;

    /// <summary>Board canvas positions are world-space pixels; anything beyond this is nonsense.</summary>
    public const double MaxBoardCoordinate = 1_000_000d;

    /// <summary>Resistance must be a positive, finite, physically plausible value.</summary>
    public const double MaxResistorOhms = 1e9;

    // Column footprints, mirrored from the frontend's shared/component-pins.js so a document
    // the client accepts is a document the server accepts.
    private const int ChipColumnSpan = 7;        // 14-pin DIP
    private const int DipSwitchColumnSpan = 8;   // 16-pin DIP
    private const int PushButtonColumnSpan = 3;
    private const int TransistorColumnSpan = 3;   // TO-92, three legs one column apart
    private const int DipSwitchPositions = 8;

    private static readonly Regex UidPattern = new($@"^[A-Za-z0-9_.:-]{{1,{MaxUidLength}}}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex HexColorPattern = new(@"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex SafeNamePattern = new(@"^[A-Za-z0-9_]{1,32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> TopLevelKeys = new(StringComparer.Ordinal) { "version", "boards", "components", "wires" };
    private static readonly HashSet<string> BoardKeys = new(StringComparer.Ordinal) { "uid", "x", "y" };
    private static readonly HashSet<string> ComponentKeys = new(StringComparer.Ordinal) { "uid", "type", "anchor", "orient", "props" };
    private static readonly HashSet<string> WireKeys = new(StringComparer.Ordinal) { "uid", "from", "to", "color" };
    private static readonly HashSet<string> MainHoleKeys = new(StringComparer.Ordinal) { "board", "kind", "col", "row" };
    private static readonly HashSet<string> RailHoleKeys = new(StringComparer.Ordinal) { "board", "kind", "rail", "index" };

    private static readonly HashSet<string> MainRows = new(StringComparer.Ordinal) { "a", "b", "c", "d", "e", "f", "g", "h", "i", "j" };
    /// <summary>Pin 1 of a gap-straddling package sits in one of the two rows flanking the centre channel.</summary>
    private static readonly HashSet<string> GapAnchorRows = new(StringComparer.Ordinal) { "e", "f" };
    private static readonly HashSet<string> RailNames = new(StringComparer.Ordinal) { "topPlus", "topMinus", "bottomPlus", "bottomMinus" };
    private static readonly HashSet<string> Orientations = new(StringComparer.Ordinal) { "up", "down", "left", "right" };

    /// <summary>A DIP package cannot straddle the gap vertically, so it has exactly two orientations 180 degrees apart.</summary>
    private static readonly HashSet<string> PackageOrientations = new(StringComparer.Ordinal) { "left", "right" };
    private static readonly HashSet<string> SupplySides = new(StringComparer.Ordinal) { "top", "bottom" };

    private static readonly HashSet<string> NamedColors = new(StringComparer.Ordinal)
    {
        "red", "green", "blue", "yellow", "orange", "white", "amber", "purple", "black", "gray"
    };

    private static readonly HashSet<string> LedColors = new(StringComparer.Ordinal)
    {
        "red", "green", "blue", "yellow", "orange", "white", "amber", "purple"
    };

    private static readonly HashSet<string> DipChipTypes = new(StringComparer.Ordinal)
    {
        "74HC00", "74HC02", "74HC04", "74HC08", "74HC32", "74HC86", "74HC30"
    };

    private static readonly HashSet<string> ComponentTypes = new(StringComparer.Ordinal)
    {
        "led", "resistor", "diode", "npn", "pnp", "nmos", "pmos",
        "pushButton", "dipSwitch8", "powerSupply5V",
        "74HC00", "74HC02", "74HC04", "74HC08", "74HC32", "74HC86", "74HC30"
    };

    private static readonly HashSet<string> LedPropKeys = new(StringComparer.Ordinal) { "color" };
    private static readonly HashSet<string> ResistorPropKeys = new(StringComparer.Ordinal) { "ohms", "to" };
    private static readonly HashSet<string> DipSwitchPropKeys = new(StringComparer.Ordinal) { "on" };
    private static readonly HashSet<string> SupplyPropKeys = new(StringComparer.Ordinal) { "board", "side" };
    private static readonly HashSet<string> NoPropKeys = new(StringComparer.Ordinal);

    /// <summary>
    /// Validates the raw circuit JSON exactly as it will be persisted. This is the
    /// only entry point, so the byte-size cap can never be bypassed.
    /// </summary>
    public BreadboardValidationResult Validate(string? circuitJson)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(circuitJson))
            {
                return BreadboardValidationResult.Fail(["circuit:missing"]);
            }

            // Measured on UTF-8 bytes, before any parsing work is done.
            if (Encoding.UTF8.GetByteCount(circuitJson) > MaxCircuitBytes)
            {
                return BreadboardValidationResult.Fail(["circuit:exceeds_max_size"]);
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(circuitJson, new JsonDocumentOptions
                {
                    MaxDepth = MaxJsonDepth,
                    CommentHandling = JsonCommentHandling.Disallow,
                    AllowTrailingCommas = false
                });
            }
            catch (JsonException)
            {
                return BreadboardValidationResult.Fail(["circuit:malformed_json"]);
            }

            using (document)
            {
                var errors = new ErrorList();
                ValidateDocument(document.RootElement, errors);
                return errors.HasErrors
                    ? BreadboardValidationResult.Fail(errors.Build())
                    : BreadboardValidationResult.Ok();
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unexpected failure validating breadboard circuit document");
            return BreadboardValidationResult.Fail(["circuit:validation_failed"]);
        }
    }

    private static void ValidateDocument(JsonElement circuit, ErrorList errors)
    {
        if (circuit.ValueKind != JsonValueKind.Object)
        {
            errors.Add("circuit", "not_an_object");
            return;
        }

        CheckKeys(circuit, "circuit", TopLevelKeys, errors);
        ValidateVersion(circuit, errors);

        // uids are unique across the whole document, so a single set covers all three collections.
        var allUids = new HashSet<string>(StringComparer.Ordinal);
        var boardUids = ValidateBoards(circuit, allUids, errors);
        ValidateComponents(circuit, boardUids, allUids, errors);
        ValidateWires(circuit, boardUids, allUids, errors);
    }

    private static void ValidateVersion(JsonElement circuit, ErrorList errors)
    {
        if (!circuit.TryGetProperty("version", out var version))
        {
            errors.Add("version", "missing");
            return;
        }

        if (version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var value) || value != SupportedVersion)
        {
            errors.Add("version", "unsupported");
        }
    }

    private static HashSet<string> ValidateBoards(JsonElement circuit, HashSet<string> allUids, ErrorList errors)
    {
        var boardUids = new HashSet<string>(StringComparer.Ordinal);

        if (!TryGetArray(circuit, "boards", MaxBoards, errors, out var boards))
        {
            return boardUids;
        }

        var index = 0;
        foreach (var board in boards.EnumerateArray())
        {
            var path = $"boards[{index++}]";

            if (board.ValueKind != JsonValueKind.Object)
            {
                errors.Add(path, "not_an_object");
                continue;
            }

            CheckKeys(board, path, BoardKeys, errors);

            var uid = ReadUid(board, path, allUids, errors);
            if (uid is not null)
            {
                boardUids.Add(uid);
            }

            ReadCoordinate(board, "x", path, errors);
            ReadCoordinate(board, "y", path, errors);
        }

        return boardUids;
    }

    private static void ValidateComponents(JsonElement circuit, HashSet<string> boardUids, HashSet<string> allUids, ErrorList errors)
    {
        if (!TryGetArray(circuit, "components", MaxComponents, errors, out var components))
        {
            return;
        }

        // One supply per rail pair: two supplies on the same pair is a contradiction the
        // engine would have to resolve as spurious contention.
        var supplySlots = new HashSet<(string Board, string Side)>();

        var index = 0;
        foreach (var component in components.EnumerateArray())
        {
            var path = $"components[{index++}]";

            if (component.ValueKind != JsonValueKind.Object)
            {
                errors.Add(path, "not_an_object");
                continue;
            }

            CheckKeys(component, path, ComponentKeys, errors);
            ReadUid(component, path, allUids, errors);

            var type = ReadEnum(component, "type", path, ComponentTypes, errors, required: true);
            if (type is null)
            {
                continue;
            }

            ValidateComponentByType(component, path, type, boardUids, supplySlots, errors);
        }
    }

    /// <summary>
    /// Every branch must account for `orient`, either by validating it or by rejecting it —
    /// a key that is in <see cref="ComponentKeys"/> but unvalidated is an arbitrary
    /// attacker-controlled slot in the stored document, which is exactly what the
    /// unknown-property allowlist exists to prevent.
    /// </summary>
    private static void ValidateComponentByType(
        JsonElement component,
        string path,
        string type,
        HashSet<string> boardUids,
        HashSet<(string Board, string Side)> supplySlots,
        ErrorList errors)
    {
        switch (type)
        {
            case "led":
                ValidateTwoHoleSpan(component, path, boardUids, errors);
                ValidateLedProps(component, path, errors);
                break;

            case "diode":
                ValidateTwoHoleSpan(component, path, boardUids, errors);
                ValidateEmptyProps(component, path, errors);
                break;

            case "npn":
            case "pnp":
            case "nmos":
            case "pmos":
                ValidateInlinePackage(component, path, TransistorColumnSpan, boardUids, errors);
                ValidateEmptyProps(component, path, errors);
                break;

            case "resistor":
                // The second terminal is explicit in props.to, so orientation is derived, not stored.
                ReadAnchor(component, path, boardUids, errors, required: true);
                RequireAbsent(component, "orient", path, errors);
                ValidateResistorProps(component, path, boardUids, errors);
                break;

            case "pushButton":
                ValidateGapPackage(component, path, PushButtonColumnSpan, boardUids, errors);
                ValidateEmptyProps(component, path, errors);
                break;

            case "dipSwitch8":
                ValidateGapPackage(component, path, DipSwitchColumnSpan, boardUids, errors);
                ValidateDipSwitchProps(component, path, errors);
                break;

            case "powerSupply5V":
                // Anchorless: both pins are derived from props, so an anchor would be meaningless data.
                RequireAbsent(component, "anchor", path, errors);
                RequireAbsent(component, "orient", path, errors);
                ValidateSupplyProps(component, path, boardUids, supplySlots, errors);
                break;

            default:
                // Reachable only if a type is added to ComponentTypes without a case here:
                // a registry/dispatch drift then fails closed instead of skipping validation.
                if (DipChipTypes.Contains(type))
                {
                    ValidateGapPackage(component, path, ChipColumnSpan, boardUids, errors);
                    ValidateEmptyProps(component, path, errors);
                }
                else
                {
                    errors.Add($"{path}.type", "unsupported");
                }

                break;
        }
    }

    /// <summary>
    /// A two-legged part spanning two holes: the anchor is the first terminal (an LED's anode,
    /// a diode's anode) and the second sits one hole away in the orient direction. A leg in a
    /// power rail is legal — electrically useless if both legs share a rail, but a real
    /// breadboard allows it — so only the footprint is checked.
    /// </summary>
    private static void ValidateTwoHoleSpan(JsonElement component, string path, HashSet<string> boardUids, ErrorList errors)
    {
        var orient = ReadEnum(component, "orient", path, Orientations, errors, required: true);
        var anchor = ReadAnchor(component, path, boardUids, errors, required: true);

        if (anchor is null || orient is null)
        {
            return;
        }

        if (orient is "up" or "down")
        {
            // Vertical travel moves one row and may legitimately cross the centre channel. A
            // rail has no rows, so the far leg of an up/down part anchored there has nowhere to go.
            if (anchor.Kind != "main")
            {
                errors.Add($"{path}.orient", "not_valid_on_rail");
                return;
            }

            // Rows a..j read top to bottom, so "up" decreases the row index — the same sign
            // convention that maps "left"/"right" to -1/+1 on the column axis. Mirrors
            // shared/board-geometry.js (team amendment A12 pins it as contract).
            var farRow = (anchor.Row[0] - 'a') + (orient == "up" ? -1 : 1);
            if (farRow < 0 || farRow >= MainRows.Count)
            {
                errors.Add($"{path}.anchor", "footprint_off_board");
            }

            return;
        }

        var farPosition = anchor.Position + (orient == "left" ? -1 : 1);
        var min = anchor.Kind == "main" ? MainColumnMin : RailIndexMin;
        var max = anchor.Kind == "main" ? MainColumnMax : RailIndexMax;

        if (farPosition < min || farPosition > max)
        {
            errors.Add($"{path}.anchor", "footprint_off_board");
        }
    }

    /// <summary>
    /// A three-legged inline package (TO-92). Its legs run along one row of the main grid, one
    /// column apart, so only "left" and "right" leave each leg in a strip of its own — a
    /// vertical placement would put two legs in the same five-hole strip, and a power rail is
    /// one continuous strip, which is why an anchor there is rejected outright.
    /// </summary>
    private static void ValidateInlinePackage(
        JsonElement component,
        string path,
        int columnSpan,
        HashSet<string> boardUids,
        ErrorList errors)
    {
        var orient = ReadEnum(component, "orient", path, PackageOrientations, errors, required: true);
        var anchor = ReadAnchor(component, path, boardUids, errors, required: true);

        if (anchor is null || orient is null)
        {
            return;
        }

        if (anchor.Kind != "main")
        {
            errors.Add($"{path}.anchor.kind", "must_be_main");
            return;
        }

        var lastColumn = anchor.Position + ((orient == "left" ? -1 : 1) * (columnSpan - 1));
        if (lastColumn < MainColumnMin || lastColumn > MainColumnMax)
        {
            errors.Add($"{path}.anchor.col", "package_off_board");
        }
    }

    /// <summary>
    /// Packages that straddle the centre gap. Pin 1 sits in row "e" or "f" on the main grid
    /// and the package runs across <paramref name="columnSpan"/> columns: row "e" reads left
    /// to right, row "f" is the same package rotated 180 degrees and reads right to left.
    /// Every pin must land on a real hole.
    /// </summary>
    private static void ValidateGapPackage(
        JsonElement component,
        string path,
        int columnSpan,
        HashSet<string> boardUids,
        ErrorList errors)
    {
        var orient = ReadEnum(component, "orient", path, PackageOrientations, errors, required: true);

        var anchor = ReadAnchor(component, path, boardUids, errors, required: true);
        if (anchor is null)
        {
            return;
        }

        if (anchor.Kind != "main")
        {
            errors.Add($"{path}.anchor.kind", "must_be_main");
            return;
        }

        if (!GapAnchorRows.Contains(anchor.Row))
        {
            errors.Add($"{path}.anchor.row", "must_straddle_gap");
            return;
        }

        // Orientation and anchor row are redundant by construction, so a document carrying
        // both is able to encode a contradiction. Reject that rather than pick a winner.
        var step = anchor.Row == "e" ? 1 : -1;
        if (orient is not null && orient != (step == 1 ? "right" : "left"))
        {
            errors.Add($"{path}.orient", "contradicts_anchor_row");
        }

        var lastColumn = anchor.Position + (step * (columnSpan - 1));
        if (lastColumn < MainColumnMin || lastColumn > MainColumnMax)
        {
            errors.Add($"{path}.anchor.col", "package_off_board");
        }
    }

    /// <summary>
    /// Rejects a key that carries no meaning for this component type, so it cannot become an
    /// unvalidated slot in the stored document. Presence is what is rejected, not just a
    /// meaningful value: an explicit JSON null is a present property, and the editor's schema
    /// refuses to load one, so accepting it here would persist a document the client cannot open.
    /// </summary>
    private static void RequireAbsent(JsonElement component, string name, string path, ErrorList errors)
    {
        if (component.TryGetProperty(name, out _))
        {
            errors.Add($"{path}.{name}", "not_applicable");
        }
    }

    /// <summary>Saved switch positions, so a bank survives a reload. Optional; exactly eight booleans when present.</summary>
    private static void ValidateDipSwitchProps(JsonElement component, string path, ErrorList errors)
    {
        if (!ReadProps(component, path, DipSwitchPropKeys, errors, required: false, out var props))
        {
            return;
        }

        if (!props.TryGetProperty("on", out var positions) || positions.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        var onPath = $"{path}.props.on";

        if (positions.ValueKind != JsonValueKind.Array)
        {
            errors.Add(onPath, "not_an_array");
            return;
        }

        if (positions.GetArrayLength() != DipSwitchPositions)
        {
            errors.Add(onPath, "wrong_length");
            return;
        }

        var index = 0;
        foreach (var position in positions.EnumerateArray())
        {
            if (position.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                errors.Add($"{onPath}[{index}]", "not_a_boolean");
            }

            index++;
        }
    }

    private static void ValidateLedProps(JsonElement component, string path, ErrorList errors)
    {
        if (!ReadProps(component, path, LedPropKeys, errors, required: true, out var props))
        {
            return;
        }

        ReadColor(props, "color", $"{path}.props", LedColors, errors, required: true);
    }

    private static void ValidateResistorProps(JsonElement component, string path, HashSet<string> boardUids, ErrorList errors)
    {
        if (!ReadProps(component, path, ResistorPropKeys, errors, required: true, out var props))
        {
            return;
        }

        var propsPath = $"{path}.props";

        if (!props.TryGetProperty("ohms", out var ohms))
        {
            errors.Add($"{propsPath}.ohms", "missing");
        }
        else if (ohms.ValueKind != JsonValueKind.Number || !ohms.TryGetDouble(out var value) || !double.IsFinite(value))
        {
            errors.Add($"{propsPath}.ohms", "not_a_number");
        }
        else if (value <= 0 || value > MaxResistorOhms)
        {
            errors.Add($"{propsPath}.ohms", "out_of_range");
        }

        // A resistor spans two holes and may reach across boards or onto a rail.
        if (!props.TryGetProperty("to", out var to))
        {
            errors.Add($"{propsPath}.to", "missing");
        }
        else
        {
            ValidateHoleRef(to, $"{propsPath}.to", boardUids, errors);
        }
    }

    private static void ValidateSupplyProps(
        JsonElement component,
        string path,
        HashSet<string> boardUids,
        HashSet<(string Board, string Side)> supplySlots,
        ErrorList errors)
    {
        if (!ReadProps(component, path, SupplyPropKeys, errors, required: true, out var props))
        {
            return;
        }

        var propsPath = $"{path}.props";

        var board = ValidateBoardReference(props, "board", propsPath, boardUids, errors);
        var side = ReadEnum(props, "side", propsPath, SupplySides, errors, required: true);

        if (board is not null && side is not null && !supplySlots.Add((board, side)))
        {
            errors.Add(propsPath, "rail_pair_already_supplied");
        }
    }

    private static void ValidateEmptyProps(JsonElement component, string path, ErrorList errors)
    {
        ReadProps(component, path, NoPropKeys, errors, required: false, out _);
    }

    private static void ValidateWires(JsonElement circuit, HashSet<string> boardUids, HashSet<string> allUids, ErrorList errors)
    {
        if (!TryGetArray(circuit, "wires", MaxWires, errors, out var wires))
        {
            return;
        }

        var index = 0;
        foreach (var wire in wires.EnumerateArray())
        {
            var path = $"wires[{index++}]";

            if (wire.ValueKind != JsonValueKind.Object)
            {
                errors.Add(path, "not_an_object");
                continue;
            }

            CheckKeys(wire, path, WireKeys, errors);
            ReadUid(wire, path, allUids, errors);

            foreach (var end in new[] { "from", "to" })
            {
                if (!wire.TryGetProperty(end, out var hole))
                {
                    errors.Add($"{path}.{end}", "missing");
                }
                else
                {
                    ValidateHoleRef(hole, $"{path}.{end}", boardUids, errors);
                }
            }

            ReadColor(wire, "color", path, NamedColors, errors, required: false);
        }
    }

    private static ParsedHole? ReadAnchor(JsonElement component, string path, HashSet<string> boardUids, ErrorList errors, bool required)
    {
        if (!component.TryGetProperty("anchor", out var anchor) || anchor.ValueKind == JsonValueKind.Null)
        {
            if (required)
            {
                errors.Add($"{path}.anchor", "missing");
            }

            return null;
        }

        return ValidateHoleRef(anchor, $"{path}.anchor", boardUids, errors);
    }

    private static ParsedHole? ValidateHoleRef(JsonElement hole, string path, HashSet<string> boardUids, ErrorList errors)
    {
        if (hole.ValueKind != JsonValueKind.Object)
        {
            errors.Add(path, "not_an_object");
            return null;
        }

        ValidateBoardReference(hole, "board", path, boardUids, errors);

        if (!hole.TryGetProperty("kind", out var kindElement))
        {
            errors.Add($"{path}.kind", "missing");
            return null;
        }

        if (kindElement.ValueKind != JsonValueKind.String)
        {
            errors.Add($"{path}.kind", "not_a_string");
            return null;
        }

        switch (kindElement.GetString())
        {
            case "main":
            {
                CheckKeys(hole, path, MainHoleKeys, errors);
                var col = ReadInt(hole, "col", path, MainColumnMin, MainColumnMax, errors);
                var row = ReadEnum(hole, "row", path, MainRows, errors, required: true);
                return col is null || row is null ? null : new ParsedHole("main", col.Value, row);
            }

            case "rail":
            {
                CheckKeys(hole, path, RailHoleKeys, errors);
                var rail = ReadEnum(hole, "rail", path, RailNames, errors, required: true);
                var index = ReadInt(hole, "index", path, RailIndexMin, RailIndexMax, errors);
                return rail is null || index is null ? null : new ParsedHole("rail", index.Value, rail);
            }

            default:
                errors.Add($"{path}.kind", "unsupported");
                return null;
        }
    }

    private static bool TryGetArray(JsonElement circuit, string name, int maxLength, ErrorList errors, out JsonElement array)
    {
        array = default;

        if (!circuit.TryGetProperty(name, out var element) || element.ValueKind == JsonValueKind.Null)
        {
            return false;
        }

        if (element.ValueKind != JsonValueKind.Array)
        {
            errors.Add(name, "not_an_array");
            return false;
        }

        if (element.GetArrayLength() > maxLength)
        {
            errors.Add(name, "too_many");
            return false;
        }

        array = element;
        return true;
    }

    private static bool ReadProps(JsonElement component, string path, IReadOnlySet<string> allowed, ErrorList errors, bool required, out JsonElement props)
    {
        if (!component.TryGetProperty("props", out props) || props.ValueKind == JsonValueKind.Null)
        {
            if (required)
            {
                errors.Add($"{path}.props", "missing");
            }

            return false;
        }

        if (props.ValueKind != JsonValueKind.Object)
        {
            errors.Add($"{path}.props", "not_an_object");
            return false;
        }

        CheckKeys(props, $"{path}.props", allowed, errors);
        return true;
    }

    private static string? ReadUid(JsonElement element, string path, HashSet<string> allUids, ErrorList errors)
    {
        var uidPath = $"{path}.uid";

        if (!element.TryGetProperty("uid", out var uidElement))
        {
            errors.Add(uidPath, "missing");
            return null;
        }

        if (uidElement.ValueKind != JsonValueKind.String)
        {
            errors.Add(uidPath, "not_a_string");
            return null;
        }

        var uid = uidElement.GetString()!;

        if (uid.Length > MaxUidLength)
        {
            errors.Add(uidPath, "too_long");
            return null;
        }

        if (!UidPattern.IsMatch(uid))
        {
            errors.Add(uidPath, "invalid_format");
            return null;
        }

        if (!allUids.Add(uid))
        {
            errors.Add(uidPath, "duplicate");
            return null;
        }

        return uid;
    }

    private static void ReadCoordinate(JsonElement element, string name, string path, ErrorList errors)
    {
        var coordinatePath = $"{path}.{name}";

        if (!element.TryGetProperty(name, out var value))
        {
            errors.Add(coordinatePath, "missing");
            return;
        }

        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number))
        {
            errors.Add(coordinatePath, "not_a_number");
            return;
        }

        if (Math.Abs(number) > MaxBoardCoordinate)
        {
            errors.Add(coordinatePath, "out_of_range");
        }
    }

    private static int? ReadInt(JsonElement element, string name, string path, int min, int max, ErrorList errors)
    {
        var intPath = $"{path}.{name}";

        if (!element.TryGetProperty(name, out var value))
        {
            errors.Add(intPath, "missing");
            return null;
        }

        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number))
        {
            errors.Add(intPath, "not_an_integer");
            return null;
        }

        if (number < min || number > max)
        {
            errors.Add(intPath, "out_of_range");
            return null;
        }

        return number;
    }

    private static string? ReadEnum(JsonElement element, string name, string path, IReadOnlySet<string> allowed, ErrorList errors, bool required)
    {
        var enumPath = $"{path}.{name}";

        if (!element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
        {
            if (required)
            {
                errors.Add(enumPath, "missing");
            }

            return null;
        }

        if (value.ValueKind != JsonValueKind.String)
        {
            errors.Add(enumPath, "not_a_string");
            return null;
        }

        var text = value.GetString()!;
        if (text.Length > MaxStringLength || !allowed.Contains(text))
        {
            errors.Add(enumPath, "unsupported");
            return null;
        }

        return text;
    }

    private static void ReadColor(JsonElement element, string name, string path, IReadOnlySet<string> namedColors, ErrorList errors, bool required)
    {
        var colorPath = $"{path}.{name}";

        if (!element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
        {
            if (required)
            {
                errors.Add(colorPath, "missing");
            }

            return;
        }

        if (value.ValueKind != JsonValueKind.String)
        {
            errors.Add(colorPath, "not_a_string");
            return;
        }

        var color = value.GetString()!;
        if (color.Length > MaxStringLength || (!namedColors.Contains(color) && !HexColorPattern.IsMatch(color)))
        {
            errors.Add(colorPath, "unsupported");
        }
    }

    /// <summary>Reads a board uid reference and confirms it names a board declared in this document.</summary>
    private static string? ValidateBoardReference(JsonElement element, string name, string path, HashSet<string> boardUids, ErrorList errors)
    {
        var boardPath = $"{path}.{name}";

        if (!element.TryGetProperty(name, out var board))
        {
            errors.Add(boardPath, "missing");
            return null;
        }

        if (board.ValueKind != JsonValueKind.String)
        {
            errors.Add(boardPath, "not_a_string");
            return null;
        }

        var uid = board.GetString()!;
        if (uid.Length > MaxUidLength || !boardUids.Contains(uid))
        {
            errors.Add(boardPath, "unknown_board");
            return null;
        }

        return uid;
    }

    /// <summary>
    /// Rejects properties outside the schema and duplicate JSON keys (System.Text.Json
    /// tolerates duplicates, which would otherwise let a document smuggle a second value
    /// past whichever occurrence the reader picks).
    /// </summary>
    private static void CheckKeys(JsonElement element, string path, IReadOnlySet<string> allowed, ErrorList errors)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var property in element.EnumerateObject())
        {
            if (!allowed.Contains(property.Name))
            {
                errors.Add($"{path}.{SafeName(property.Name)}", "unknown_property");
            }
            else if (!seen.Add(property.Name))
            {
                errors.Add($"{path}.{property.Name}", "duplicate_property");
            }
        }
    }

    /// <summary>Unknown property names come from untrusted input, so only echo them when they are plainly safe.</summary>
    private static string SafeName(string name) => SafeNamePattern.IsMatch(name) ? name : "?";

    /// <summary>
    /// A hole reference that passed validation. <paramref name="Position"/> is the column for
    /// a main-grid hole and the tie-point index for a rail hole; <paramref name="Row"/> is the
    /// row letter or the rail name respectively.
    /// </summary>
    private sealed record ParsedHole(string Kind, int Position, string Row);

    private sealed class ErrorList
    {
        private readonly List<string> _errors = [];
        private bool _truncated;

        public bool HasErrors => _errors.Count > 0;

        public void Add(string path, string reason)
        {
            if (_errors.Count >= MaxErrors)
            {
                _truncated = true;
                return;
            }

            _errors.Add($"{path}:{reason}");
        }

        public IReadOnlyList<string> Build() => _truncated ? [.. _errors, "errors:truncated"] : _errors;
    }
}
