using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/admin")]
public class AdminApi(DbExecutor dbExecutor) : ControllerBase
{
    [HttpGet("users")]
    public async Task<IActionResult> GetUsers([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var authUserId = GetUserIdFromAuth();
        if (authUserId == null) return Unauthorized();

        if (!await IsAdmin(authUserId.Value)) return Forbid();

        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 100) pageSize = 20;
        var offset = (page - 1) * pageSize;

        var totalCount = await dbExecutor.ExecuteAsync<long>(
            "SELECT COUNT(*) FROM app.users");

        var users = await dbExecutor.ExecuteListReaderAsync(
            @"SELECT u.id, u.username, u.email, u.is_active
              FROM app.users u
              ORDER BY u.id
              LIMIT @PageSize OFFSET @Offset",
            reader => new
            {
                Id = reader.GetInt64(0),
                Username = reader.GetString(1),
                Email = reader.GetString(2),
                IsActive = reader.GetBoolean(3)
            },
            new { PageSize = pageSize, Offset = offset });

        // Fetch all roles for these users in one query using a subquery
        var userRoles = users.Count > 0
            ? await dbExecutor.ExecuteListReaderAsync(
                @"SELECT ur.user_id, r.id, r.name
                  FROM app.user_roles ur
                  JOIN app.roles r ON ur.role_id = r.id
                  WHERE ur.user_id IN (
                      SELECT u.id FROM app.users u ORDER BY u.id LIMIT @PageSize OFFSET @Offset
                  )",
                reader => new
                {
                    UserId = reader.GetInt64(0),
                    RoleId = reader.GetInt64(1),
                    RoleName = reader.GetString(2)
                },
                new { PageSize = pageSize, Offset = offset })
            : [];

        var result = users.Select(u => new
        {
            u.Id,
            u.Username,
            u.Email,
            u.IsActive,
            Roles = userRoles.Where(r => r.UserId == u.Id)
                             .Select(r => new { Id = r.RoleId, Name = r.RoleName })
                             .ToList()
        });

        return Ok(new { users = result, totalCount });
    }

    [HttpGet("roles")]
    public async Task<IActionResult> GetRoles()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();

        if (!await IsAdmin(userId.Value)) return Forbid();

        var roles = await dbExecutor.ExecuteListReaderAsync(
            "SELECT id, name FROM app.roles ORDER BY id",
            reader => new { Id = reader.GetInt64(0), Name = reader.GetString(1) });

        return Ok(roles);
    }

    [HttpPost("roles")]
    public async Task<IActionResult> CreateRole([FromBody] CreateRoleRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();

        if (!await IsAdmin(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Role name is required" });

        var name = request.Name.Trim().ToLowerInvariant();

        var existing = await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.roles WHERE name = @Name)",
            new { Name = name });

        if (existing)
            return BadRequest(new { error = "Role already exists" });

        var role = await dbExecutor.ExecuteReaderAsync(
            "INSERT INTO app.roles (name) VALUES (@Name) RETURNING id, name",
            reader => new { Id = reader.GetInt64(0), Name = reader.GetString(1) },
            new { Name = name });

        return Ok(role);
    }

    [HttpPost("users/{targetUserId}/roles/{roleId}")]
    public async Task<IActionResult> AssignRole(long targetUserId, long roleId)
    {
        var adminId = GetUserIdFromAuth();
        if (adminId == null) return Unauthorized();

        if (!await IsAdmin(adminId.Value)) return Forbid();

        var userExists = await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.users WHERE id = @UserId)",
            new { UserId = targetUserId });
        if (!userExists) return NotFound(new { error = "User not found" });

        var roleExists = await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.roles WHERE id = @RoleId)",
            new { RoleId = roleId });
        if (!roleExists) return NotFound(new { error = "Role not found" });

        var alreadyAssigned = await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.user_roles WHERE user_id = @UserId AND role_id = @RoleId)",
            new { UserId = targetUserId, RoleId = roleId });
        if (alreadyAssigned) return Ok(new { success = true });

        await dbExecutor.ExecuteNonQueryAsync(
            "INSERT INTO app.user_roles (user_id, role_id) VALUES (@UserId, @RoleId)",
            new { UserId = targetUserId, RoleId = roleId });

        return Ok(new { success = true });
    }

    [HttpDelete("users/{targetUserId}/roles/{roleId}")]
    public async Task<IActionResult> RemoveRole(long targetUserId, long roleId)
    {
        var adminId = GetUserIdFromAuth();
        if (adminId == null) return Unauthorized();

        if (!await IsAdmin(adminId.Value)) return Forbid();

        await dbExecutor.ExecuteNonQueryAsync(
            "DELETE FROM app.user_roles WHERE user_id = @UserId AND role_id = @RoleId",
            new { UserId = targetUserId, RoleId = roleId });

        return Ok(new { success = true });
    }

    private async Task<bool> IsAdmin(long userId)
    {
        return await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.roles r ON ur.role_id = r.id WHERE ur.user_id = @UserId AND r.name = 'admin')",
            new { UserId = userId });
    }

    private long? GetUserIdFromAuth()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && long.TryParse(userIdClaim, out var jwtUserId))
        {
            return jwtUserId;
        }

        var userIdString = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userIdString) && long.TryParse(userIdString, out var sessionUserId))
        {
            return sessionUserId;
        }

        return null;
    }
}

public record CreateRoleRequest(string Name);
