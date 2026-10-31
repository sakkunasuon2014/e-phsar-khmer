"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Eye, Pencil, Trash2, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTeamUsers, type AdminUsersResult } from "@/actions/admin-users";
import { User } from "@/types/user";
import { z } from "zod";
import Image from "next/image";
import { usersSchema, editUserSchema } from "@/schemas/user";
import { toast } from "@/components/ui/sonner";
import {
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldContent,
  FieldLegend,
  FieldDescription,
  Field,
  FieldError,
} from "@/components/ui/field";
import { useAppForm } from "@/components/form/hooks";
import { createUser, updateUser, deleteUser } from "@/actions/user";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  DateCell,
  PrimaryCell,
  RowActions,
  formatCount,
  type AdminColumn,
} from "@/components/dashboard/admin-table";
type AddUserFormData = z.infer<typeof usersSchema>;
type EditUserFormData = z.infer<typeof editUserSchema>;

/** Stored numbers are already E.164 ("+855…") — never prefix a second "+". */
function formatPhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

/** Team page manages staff only; customers register on the marketplace. */
const TEAM_ROLES = ["admin", "super_admin"] as const;

function roleLabel(role: (typeof TEAM_ROLES)[number]): string {
  return role === "super_admin" ? "Super Admin" : "Admin";
}

// ─── Add User Form ─────────────────────────────────────────────────────────────

function AddUserForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (data: AddUserFormData) => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: "",
      username: "",
      email: "",
      profile: "",
      password: "",
      phones: [{ phone: "" }],
      role: "admin" as AddUserFormData["role"],
    },
    validators: {
      onChange: usersSchema,
      onSubmit: usersSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await createUser(value);

      if (res.success) {
        form.reset();
        onSuccess(value);
      } else {
        toast.error(res.error ?? "Failed to add user");
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <div className="px-1 pr-3">
        <FieldGroup className="py-4">
          <form.AppField name="name">
            {(field) => <field.Input label="Name" required />}
          </form.AppField>

          <form.AppField name="username">
            {(field) => <field.Input label="Username" required />}
          </form.AppField>

          <form.AppField name="email">
            {(field) => <field.Input label="Email" required />}
          </form.AppField>

          <form.AppField name="password">
            {(field) => (
              <field.Input label="Password" type="password" required />
            )}
          </form.AppField>

          {/* Phone Numbers (array field) */}
          <form.Field name="phones" mode="array">
            {(field) => (
              <FieldSet>
                <div className="flex justify-between gap-2 items-center">
                  <FieldContent>
                    <FieldLegend variant="label" className="mb-0">
                      Phone Numbers
                    </FieldLegend>
                    <FieldDescription>
                      Add up to 3 phone numbers for this user.
                    </FieldDescription>
                    {field.state.meta.errors && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </FieldContent>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => field.pushValue({ phone: "" })}
                    disabled={field.state.value.length >= 3}
                    className="bg-green-500 text-white hover:bg-green-600 hover:text-white cursor-pointer"
                  >
                    Add Phone
                  </Button>
                </div>
                <FieldGroup>
                  {field.state.value.map((_, index) => (
                    <form.Field key={index} name={`phones[${index}].phone`}>
                      {(innerField) => {
                        const isInvalid =
                          innerField.state.meta.isTouched &&
                          !innerField.state.meta.isValid;
                        return (
                          <Field
                            orientation="horizontal"
                            data-invalid={isInvalid}
                          >
                            <FieldContent>
                              <InputGroup>
                                <InputGroupInput
                                  id={innerField.name}
                                  aria-invalid={isInvalid}
                                  aria-label={`Phone number ${index + 1}`}
                                  type="tel"
                                  placeholder={`Phone ${index + 1}`}
                                  onBlur={innerField.handleBlur}
                                  onChange={(e) =>
                                    innerField.handleChange(e.target.value)
                                  }
                                  value={innerField.state.value}
                                />
                                {field.state.value.length > 1 && (
                                  <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      onClick={() => field.removeValue(index)}
                                      aria-label={`Remove phone ${index + 1}`}
                                    >
                                      <XIcon />
                                    </InputGroupButton>
                                  </InputGroupAddon>
                                )}
                              </InputGroup>
                              {isInvalid && (
                                <FieldError
                                  errors={innerField.state.meta.errors}
                                />
                              )}
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            )}
          </form.Field>

          {/* Profile Image */}
          <form.AppField name="profile">
            {(field) => (
              <>
                <FieldLabel htmlFor="add-profile">Profile Image</FieldLabel>
                {field.state.value && (
                  <div className="flex justify-center w-full pt-2">
                    <Image
                      src={field.state.value}
                      alt="Profile preview"
                      width={120}
                      height={120}
                      className="w-32 h-32 object-cover rounded-full border border-border"
                      unoptimized
                    />
                  </div>
                )}
                <Input
                  id="add-profile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      form.setFieldValue("profile", URL.createObjectURL(file));
                    }
                  }}
                />
              </>
            )}
          </form.AppField>

          {/* Role */}
          <form.AppField name="role">
            {(field) => (
              <field.Select label="Role" required>
                {TEAM_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </field.Select>
            )}
          </form.AppField>
        </FieldGroup>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-sm cursor-pointer"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Edit User Form ────────────────────────────────────────────────────────────

function EditUserForm({
  user,
  onSuccess,
  onCancel,
}: {
  user: User;
  onSuccess: (data: EditUserFormData) => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: user.name,
      username: user.username,
      email: user.email,
      profile: user.profileImage ?? "",
      password: "",
      phones:
        user.networks.length > 0
          ? user.networks.map((n) => ({ phone: n }))
          : [{ phone: "" }],
      role: ((TEAM_ROLES as readonly string[]).includes(user.role)
        ? user.role
        : "admin") as EditUserFormData["role"],
    } satisfies EditUserFormData,
    validators: {
      onChange: editUserSchema,
      onSubmit: editUserSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await updateUser(user.userId, value);
      if (res.success) {
        onSuccess(value);
        toast.success("User updated successfully");
      } else {
        toast.error(res.error ?? "Failed to update user");
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <div className="px-1 pr-3">
        <FieldGroup className="py-4">
          <form.AppField name="name">
            {(field) => <field.Input label="Name" required />}
          </form.AppField>

          <form.AppField name="username">
            {(field) => <field.Input label="Username" required />}
          </form.AppField>

          <form.AppField name="email">
            {(field) => <field.Input label="Email" required />}
          </form.AppField>

          <form.AppField name="password">
            {(field) => (
              <field.Input
                label="Password"
                type="password"
                description="Leave empty to keep current password"
              />
            )}
          </form.AppField>

          {/* Phone Numbers (array field) */}
          <form.Field name="phones" mode="array">
            {(field) => (
              <FieldSet>
                <div className="flex justify-between gap-2 items-center">
                  <FieldContent>
                    <FieldLegend variant="label" className="mb-0">
                      Phone Numbers
                    </FieldLegend>
                    <FieldDescription>
                      Add up to 3 phone numbers for this user.
                    </FieldDescription>
                    {field.state.meta.errors && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </FieldContent>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => field.pushValue({ phone: "" })}
                    disabled={field.state.value.length >= 3}
                    className="bg-green-500 text-white hover:bg-green-600 hover:text-white cursor-pointer"
                  >
                    Add Phone
                  </Button>
                </div>
                <FieldGroup>
                  {field.state.value.map((_, index) => (
                    <form.Field key={index} name={`phones[${index}].phone`}>
                      {(innerField) => {
                        const isInvalid =
                          innerField.state.meta.isTouched &&
                          !innerField.state.meta.isValid;
                        return (
                          <Field
                            orientation="horizontal"
                            data-invalid={isInvalid}
                          >
                            <FieldContent>
                              <InputGroup>
                                <InputGroupInput
                                  id={innerField.name}
                                  aria-invalid={isInvalid}
                                  aria-label={`Phone number ${index + 1}`}
                                  type="tel"
                                  placeholder={`Phone ${index + 1}`}
                                  onBlur={innerField.handleBlur}
                                  onChange={(e) =>
                                    innerField.handleChange(e.target.value)
                                  }
                                  value={innerField.state.value}
                                />
                                {field.state.value.length > 1 && (
                                  <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      onClick={() => field.removeValue(index)}
                                      aria-label={`Remove phone ${index + 1}`}
                                    >
                                      <XIcon />
                                    </InputGroupButton>
                                  </InputGroupAddon>
                                )}
                              </InputGroup>
                              {isInvalid && (
                                <FieldError
                                  errors={innerField.state.meta.errors}
                                />
                              )}
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            )}
          </form.Field>

          {/* Profile Image */}
          <form.AppField name="profile">
            {(field) => (
              <>
                <FieldLabel htmlFor="edit-profile">Profile Image</FieldLabel>
                {field.state.value && (
                  <div className="flex justify-center w-full pt-2">
                    <Image
                      src={field.state.value}
                      alt="Profile preview"
                      width={120}
                      height={120}
                      className="w-32 h-32 object-cover rounded-full border border-border"
                      unoptimized
                    />
                  </div>
                )}
                <Input
                  id="edit-profile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      form.setFieldValue("profile", URL.createObjectURL(file));
                    }
                  }}
                />
              </>
            )}
          </form.AppField>

          {/* Role */}
          <form.AppField name="role">
            {(field) => (
              <field.Select label="Role" required>
                {TEAM_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </field.Select>
            )}
          </form.AppField>
        </FieldGroup>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-sm cursor-pointer"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
        >
          Save Changes
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Delete User Form ──────────────────────────────────────────────────────────

function DeleteUserForm({
  user,
  onSuccess,
  onCancel,
}: {
  user: User;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    try {
      setIsDeleting(true);
      const res = await deleteUser({ userId: user.userId });

      if (res.success) {
        onSuccess();
        toast.success("User deleted successfully");
      } else {
        toast.error("Failed to delete user");
      }
    } catch (error) {
      console.error("Delete Error:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete User</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete{" "}
          <strong className="font-semibold text-red-500">
            &quot;{user.name}&quot;
          </strong>
          ? This action cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          className="h-9 rounded-sm cursor-pointer"
          onClick={onCancel}
          disabled={isDeleting}
        >
          Cancel
        </Button>
        <Button
          className="h-9 bg-red-500 text-white rounded-sm hover:bg-red-600 hover:text-white cursor-pointer"
          onClick={handleDelete}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Main TeamPage ─────────────────────────────────────────────────────────────

/** Online/offline reads the same on the row and in the detail dialog. */
function StatusBadge({ status }: { status: User["status"] }) {
  return (
    <Badge variant="outline">
      <span
        className={`size-1.5 rounded-full ${
          status === "Online" ? "bg-emerald-500" : "bg-rose-500"
        }`}
      />
      {status}
    </Badge>
  );
}

export default function TeamPage({
  initialData,
}: {
  initialData?: AdminUsersResult;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin", "team"],
    queryFn: () => getTeamUsers(),
    initialData,
  });
  const users = data?.users;

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [viewUser, setViewUser] = useState<User | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState("all");

  // Belt-and-braces: the feed only asks for staff roles, so a customer row can
  // never reach this table.
  const teamUsers = useMemo(
    () => (users ?? []).filter((user) => user.role.toLowerCase() !== "user"),
    [users],
  );
  const onlineCount = teamUsers.filter(
    (user) => user.status === "Online",
  ).length;
  const offlineCount = teamUsers.filter(
    (user) => user.status === "Offline",
  ).length;

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return teamUsers.filter((user) => {
      if (tab === "online" && user.status !== "Online") return false;
      if (tab === "offline" && user.status !== "Offline") return false;
      if (!query) return true;
      return [
        user.userId,
        user.name,
        user.username,
        user.email,
        ...user.networks.map(formatPhone),
        user.role,
        user.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [teamUsers, searchQuery, tab]);

  const refreshTeam = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "team"] });

  // ── Add handler ──────────────────────────────────────────────────────────────
  const handleAddSuccess = () => {
    refreshTeam();
    setIsAddDialogOpen(false);
    toast.success("User added successfully");
  };

  // ── Edit handler ─────────────────────────────────────────────────────────────
  const handleEditSuccess = () => {
    refreshTeam();
    setIsEditDialogOpen(false);
    setSelectedUser(null);
  };

  // ── Delete handler ────────────────────────────────────────────────────────────
  const handleDeleteSuccess = () => {
    refreshTeam();
    setIsDeleteDialogOpen(false);
    setSelectedUser(null);
  };

  const columns = useMemo<AdminColumn<User>[]>(
    () => [
      {
        key: "member",
        header: "Member",
        sortValue: (user) => user.name,
        cell: (user) => (
          <PrimaryCell
            shape="round"
            image={user.profileImage}
            alt={user.name}
            title={user.name}
            subtitle={user.email || "No email"}
          />
        ),
      },
      {
        key: "username",
        header: "Username",
        sortValue: (user) => user.username,
        cell: (user) =>
          user.username ? (
            <span className="text-muted-foreground">@{user.username}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "phone",
        header: "Phone",
        sortValue: (user) => formatPhone(user.networks[0] ?? ""),
        cell: (user) => {
          const phones = user.networks
            .filter((value) => value !== "")
            .map(formatPhone);
          if (phones.length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span>{phones[0]}</span>
              {phones.length > 1 ? (
                <span
                  className="type-meta text-muted-foreground"
                  title={phones.slice(1).join(", ")}
                >
                  +{phones.length - 1} more
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "role",
        header: "Role",
        sortValue: (user) => user.role,
        cell: (user) => (
          <Badge variant="secondary">
            {user.role === "super_admin" ? "Super Admin" : "Admin"}
          </Badge>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortValue: (user) => user.status,
        cell: (user) => <StatusBadge status={user.status} />,
      },
      {
        key: "joined",
        header: "Joined",
        sortValue: (user) => user.createdAt,
        cell: (user) => <DateCell value={user.createdAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (user) => (
          <RowActions
            id={user.userId}
            actions={[
              {
                label: "View",
                icon: <Eye className="mr-2 size-4" />,
                onSelect: () => setViewUser(user),
              },
              {
                label: "Edit",
                icon: <Pencil className="mr-2 size-4" />,
                tone: "warning",
                onSelect: () => {
                  setSelectedUser(user);
                  setIsEditDialogOpen(true);
                },
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => {
                  setSelectedUser(user);
                  setIsDeleteDialogOpen(true);
                },
              },
            ]}
          />
        ),
      },
    ],
    [],
  );

  return (
    <>
      <AdminPage
        title="Team"
        description="Manage your team and roles"
        action={
          <Button
            className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="mr-2 size-4" />
            Add Member
          </Button>
        }
        toolbar={
          <AdminSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search name, username, email, phone, role..."
          />
        }
      >
        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all" className="cursor-pointer">
              All Users
            </TabsTrigger>
            <TabsTrigger value="online" className="cursor-pointer">
              Online
              <Badge className="bg-green-500 hover:bg-green-600 text-white ml-1.5 px-1.5 py-0.5 type-meta">
                {formatCount(onlineCount)}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="offline" className="cursor-pointer">
              Offline
              <Badge className="bg-red-500 hover:bg-red-600 text-white ml-1.5 px-1.5 py-0.5 type-meta">
                {formatCount(offlineCount)}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <AdminTable
          columns={columns}
          rows={filteredUsers}
          rowKey={(user) => user.userId}
          pageSize={20}
          resetKey={`${searchQuery}:${tab}`}
          emptyTitle="Not found"
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>

      {/* ── View User Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!viewUser} onOpenChange={() => setViewUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>View user information</DialogDescription>
          </DialogHeader>
          {viewUser && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="size-16">
                  <AvatarImage
                    src={viewUser.profileImage}
                    alt={viewUser.name}
                  />
                  <AvatarFallback className="text-lg">
                    {viewUser.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="type-card-heading">{viewUser.name}</h3>
                  <div className="type-body-sm text-muted-foreground">
                    {viewUser.username}
                  </div>
                  <p className="type-body-sm text-muted-foreground">
                    {viewUser.email}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <p className="type-body-sm text-muted-foreground">User ID</p>
                  <p className="font-mono type-body-sm">{viewUser.userId}</p>
                </div>
                <div>
                  <p className="type-body-sm text-muted-foreground">Role</p>
                  <div className="mt-1">{viewUser.role}</div>
                </div>
                <div>
                  <p className="type-body-sm text-muted-foreground">Status</p>
                  <div className="mt-1">
                    <StatusBadge status={viewUser.status} />
                  </div>
                </div>
                <div>
                  <p className="type-body-sm text-muted-foreground">Phone(s)</p>
                  <div className="type-body-sm mt-1">
                    {viewUser.networks.filter(Boolean).join(", ") || "—"}
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-20">
                  <div>
                    <p className="type-body-sm text-muted-foreground">
                      Created At:
                    </p>
                    <p>
                      {new Date(viewUser.createdAt).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="type-body-sm text-muted-foreground">
                      Updated At:
                    </p>
                    <p>
                      {new Date(viewUser.updatedAt).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add User Dialog ───────────────────────────────────────────────── */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sky-500">Add Team Member</DialogTitle>
            <DialogDescription>
              Create a new staff account for team management.
            </DialogDescription>
          </DialogHeader>
          <AddUserForm
            onSuccess={handleAddSuccess}
            onCancel={() => setIsAddDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) setSelectedUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sky-500">Edit User</DialogTitle>
            <DialogDescription>Update user information.</DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <EditUserForm
              key={selectedUser.userId}
              user={selectedUser}
              onSuccess={handleEditSuccess}
              onCancel={() => {
                setIsEditDialogOpen(false);
                setSelectedUser(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete User Dialog ────────────────────────────────────────────── */}
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setSelectedUser(null);
        }}
      >
        <DialogContent>
          {selectedUser && (
            <DeleteUserForm
              user={selectedUser}
              onSuccess={handleDeleteSuccess}
              onCancel={() => {
                setIsDeleteDialogOpen(false);
                setSelectedUser(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
