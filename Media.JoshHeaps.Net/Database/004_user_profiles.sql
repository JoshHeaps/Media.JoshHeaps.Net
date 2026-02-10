-- User Profiles Table
CREATE TABLE IF NOT EXISTS app.user_profiles (
    user_id BIGINT PRIMARY KEY,
    bio TEXT NULL,
    avatar_url VARCHAR(500) NULL,
    location VARCHAR(100) NULL,
    website VARCHAR(200) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
);

-- Create a trigger to automatically create a profile when a user is created
CREATE OR REPLACE FUNCTION app.create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO app.user_profiles (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_user_profile
AFTER INSERT ON app.users
FOR EACH ROW
EXECUTE FUNCTION app.create_user_profile();
